import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { type INotificationService } from '../notifications.port.js';
import { createDatabaseMock, cleanUp } from '../../utils/test-utils/database-tools.ts.js';
import { ProductService } from './product.service.js';
import { products, type Product } from '@/db/schema.js';
import { type Database } from '@/db/type.js';

describe('ProductService', () => {
	let notificationServiceMock: DeepMockProxy<INotificationService>;
	let productService: ProductService;
	let databaseMock: Database;
	let databaseName: string;

	beforeEach(async () => {
		({ databaseMock, databaseName } = await createDatabaseMock());
		notificationServiceMock = mockDeep<INotificationService>();
		productService = new ProductService({
			ns: notificationServiceMock,
			db: databaseMock,
		});
	});

	afterEach(async () => cleanUp(databaseName));

	/**
	 * Helper function to create a test product.
	 */
	function createTestProduct(overrides: Partial<Product> = {}): Product {
		return {
			id: 1,
			leadTime: 10,
			available: 5,
			type: 'NORMAL',
			name: 'Test Product',
			expiryDate: null,
			seasonStartDate: null,
			seasonEndDate: null,
			...overrides,
		};
	}

	it('should send a delay notification when product is delayed', async () => {
		// GIVEN
		const product = createTestProduct({ available: 0, leadTime: 15 });
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.notifyDelay(product.leadTime, product);

		// THEN
		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(
			product.leadTime,
			product.name
		);
		const updatedProduct = await databaseMock.query.products.findFirst({
			where: (p, { eq }) => eq(p.id, product.id),
		});
		expect(updatedProduct).toEqual({ ...product, leadTime: 15 });
	});

	it('should handle seasonal product availability correctly', async () => {
		// GIVEN
		const seasonStart = new Date(Date.now() - 1000 * 60 * 60 * 24 * 5); // 5 days ago
		const seasonEnd = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10); // 10 days from now
		const product = createTestProduct({
			type: 'SEASONAL',
			seasonStartDate: seasonStart,
			seasonEndDate: seasonEnd,
			available: 0,
			leadTime: 5,
		});
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.handleSeasonalProduct(product);

		// THEN
		expect(notificationServiceMock.sendOutOfStockNotification).not.toHaveBeenCalled();
		expect(notificationServiceMock.sendDelayNotification).toHaveBeenCalledWith(
			product.leadTime,
			product.name
		);
	});

	it('should send an out-of-stock notification when seasonal product is not in season', async () => {
		// GIVEN
		const futureStart = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days ahead
		const product = createTestProduct({
			type: 'SEASONAL',
			seasonStartDate: futureStart,
			seasonEndDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
			available: 0,
		});
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.handleSeasonalProduct(product);

		// THEN
		expect(notificationServiceMock.sendOutOfStockNotification).toHaveBeenCalledWith(product.name);
	});

	it('should handle expired product correctly', async () => {
		// GIVEN
		const expiredDate = new Date(Date.now() - 1000 * 60 * 60 * 24); // Yesterday
		const product = createTestProduct({
			type: 'EXPIRABLE',
			expiryDate: expiredDate,
			available: 5,
		});
		await databaseMock.insert(products).values(product);

		// WHEN
		await productService.handleExpiredProduct(product);

		// THEN
		expect(notificationServiceMock.sendExpirationNotification).toHaveBeenCalledWith(
			product.name,
			expiredDate
		);
		const updatedProduct = await databaseMock.query.products.findFirst({
			where: (p, { eq }) => eq(p.id, product.id),
		});
		expect(updatedProduct?.available).toBe(0);
	});
});
