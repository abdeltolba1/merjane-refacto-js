/* eslint-disable @typescript-eslint/switch-exhaustiveness-check */
/* eslint-disable no-await-in-loop */
import { eq } from 'drizzle-orm';
import fastifyPlugin from 'fastify-plugin';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { orders, products } from '@/db/schema.js';

export const myController = fastifyPlugin(async server => {
	// Add schema validator and serializer
	server.setValidatorCompiler(validatorCompiler);
	server.setSerializerCompiler(serializerCompiler);

	server.withTypeProvider<ZodTypeProvider>().post('/orders/:orderId/processOrder', {
		schema: {
			params: z.object({ orderId: z.coerce.number() }),
		},
	}, async (request, reply) => {
		const db = server.diContainer.resolve('db');
		const ps = server.diContainer.resolve('ps');
		const { orderId } = request.params;

		const order = await db.query.orders.findFirst({
			where: eq(orders.id, orderId),
			with: {
				products: { columns: {}, with: { product: true } },
			},
		});

		if (!order) {
			return reply.status(404).send({ error: 'Order not found' });
		}

		console.log(order);

		await processProducts(order.products, db, ps);
		reply.send({ orderId: order.id });
	});
});

async function processProducts(productList: typeof products[], db: any, ps: any) {
	const currentDate = new Date();

	for (const { product } of productList) {
		if (!product) continue;

		switch (product.type) {
			case 'NORMAL':
				await handleNormalProduct(product, db, ps);
				break;

			case 'SEASONAL':
				await handleSeasonalProduct(product, db, ps, currentDate);
				break;

			case 'EXPIRABLE':
				await handleExpirableProduct(product, db, ps, currentDate);
				break;
		}
	}
}

async function handleNormalProduct(product: any, db: any, ps: any) {
	if (product.available > 0) {
		product.available -= 1;
		await db.update(products).set(product).where(eq(products.id, product.id));
	} else if (product.leadTime > 0) {
		await ps.notifyDelay(product.leadTime, product);
	}
}

async function handleSeasonalProduct(product: any, db: any, ps: any, currentDate: Date) {
	if (product.seasonStartDate && product.seasonEndDate && currentDate > product.seasonStartDate && currentDate < product.seasonEndDate && product.available > 0) {
		product.available -= 1;
		await db.update(products).set(product).where(eq(products.id, product.id));
	} else {
		await ps.handleSeasonalProduct(product);
	}
}

async function handleExpirableProduct(product: any, db: any, ps: any, currentDate: Date) {
	if (product.available > 0 && product.expiryDate && product.expiryDate > currentDate) {
		product.available -= 1;
		await db.update(products).set(product).where(eq(products.id, product.id));
	} else {
		await ps.handleExpiredProduct(product);
	}
}
