import {
	describe, it, expect, beforeEach, afterEach
} from 'vitest';
import { type FastifyInstance } from 'fastify';
import supertest from 'supertest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';
import { asValue } from 'awilix';
import { type INotificationService } from '@/services/notifications.port.js';
import { type ProductInsert, products, orders, ordersToProducts } from '@/db/schema.js';
import { type Database } from '@/db/type.js';
import { buildFastify } from '@/fastify.js';

describe('Order Processing Integration Tests', () => {
	let fastify: FastifyInstance;
	let database: Database;
	let notificationServiceMock: DeepMockProxy<INotificationService>;

	beforeEach(async () => {
		notificationServiceMock = mockDeep<INotificationService>();

		fastify = await buildFastify();
		fastify.diContainer.register({
			// Register the mocked notification service
			ns: asValue(notificationServiceMock as INotificationService),
		});
		await fastify.ready();
		database = fastify.database;
	});

	afterEach(async () => {
		await fastify.close();
	});

	it('should process an order successfully', async () => {
		const client = supertest(fastify.server);
		const allProducts = createProducts();
		const orderId = await database.transaction(async tx => {
			const productList = await tx.insert(products).values(allProducts).returning({ productId: products.id });
			const [order] = await tx.insert(orders).values([{}]).returning({ orderId: orders.id });
			await tx.insert(ordersToProducts).values(productList.map(p => ({ orderId: order!.orderId, productId: p.productId })));
			return order!.orderId;
		});

		const response = await client.post(`/orders/${orderId}/processOrder`)
			.expect(200)
			.expect('Content-Type', /application\/json/);

		expect(response.body.orderId).toBe(orderId);
	});

	it('should correctly handle out-of-stock NORMAL products', async () => {
		const client = supertest(fastify.server);
		const outOfStockProduct = createProducts().find(p => p.name === 'USB Dongle')!;
		const orderId = await createOrder([outOfStockProduct]);

		await client.post(`/orders/${orderId}/processOrder`).expect(200);

		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalled();
	});

	it('should correctly handle expired EXPIRABLE products', async () => {
		const client = supertest(fastify.server);
		const expiredProduct = createProducts().find(p => p.name === 'Milk')!;
		const orderId = await createOrder([expiredProduct]);

		await client.post(`/orders/${orderId}/processOrder`).expect(200);

		expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith(expiredProduct.name, expiredProduct.expiryDate);
	});

	it('should correctly handle out-of-season SEASONAL products', async () => {
		const client = supertest(fastify.server);
		const outOfSeasonProduct = createProducts().find(p => p.name === 'Grapes')!;
		const orderId = await createOrder([outOfSeasonProduct]);

		await client.post(`/orders/${orderId}/processOrder`).expect(200);

		expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(outOfSeasonProduct.name);
	});

	async function createOrder(productList: ProductInsert[]): Promise<number> {
		return await database.transaction(async tx => {
			const insertedProducts = await tx.insert(products).values(productList).returning({ productId: products.id });
			const [order] = await tx.insert(orders).values([{}]).returning({ orderId: orders.id });
			await tx.insert(ordersToProducts).values(insertedProducts.map(p => ({ orderId: order!.orderId, productId: p.productId })));
			return order!.orderId;
		});
	}

	function createProducts(): ProductInsert[] {
		const d = 24 * 60 * 60 * 1000;
		return [
			{ leadTime: 15, available: 30, type: 'NORMAL', name: 'USB Cable' },
			{ leadTime: 10, available: 0, type: 'NORMAL', name: 'USB Dongle' },
			{ leadTime: 15, available: 30, type: 'EXPIRABLE', name: 'Butter', expiryDate: new Date(Date.now() + (26 * d)) },
			{ leadTime: 90, available: 6, type: 'EXPIRABLE', name: 'Milk', expiryDate: new Date(Date.now() - (2 * d)) },
			{ leadTime: 15, available: 30, type: 'SEASONAL', name: 'Watermelon', seasonStartDate: new Date(Date.now() - (2 * d)), seasonEndDate: new Date(Date.now() + (58 * d)) },
			{ leadTime: 15, available: 30, type: 'SEASONAL', name: 'Grapes', seasonStartDate: new Date(Date.now() + (180 * d)), seasonEndDate: new Date(Date.now() + (240 * d)) }
		];
	}
});
