import { type Cradle } from '@fastify/awilix';
import { eq } from 'drizzle-orm';
import { type INotificationService } from '../notifications.port.js';
import { products, type Product } from '@/db/schema.js';
import { type Database } from '@/db/type.js';

export class ProductService {
	private readonly ns: INotificationService;
	private readonly db: Database;

	public constructor({ ns, db }: Pick<Cradle, 'ns' | 'db'>) {
		this.ns = ns;
		this.db = db;
	}

	/**
	 * Updates the product in the database.
	 */
	private async updateProduct(p: Product): Promise<void> {
		await this.db.update(products).set(p).where(eq(products.id, p.id));
	}

	/**
	 * Notifies a delay for a product and updates its lead time.
	 */
	public async notifyDelay(leadTime: number, p: Product): Promise<void> {
		p.leadTime = leadTime;
		await this.updateProduct(p);
		this.ns.sendDelayNotification(leadTime, p.name);
	}

	/**
	 * Handles seasonal product availability.
	 */
	public async handleSeasonalProduct(p: Product): Promise<void> {
		const currentDate = new Date();
		const daysToMilliseconds = (days: number) => days * 24 * 60 * 60 * 1000;

		if (!p.seasonEndDate || !p.seasonStartDate) {
			this.ns.sendOutOfStockNotification(p.name);
			return;
		}

		const leadTimeExceeded = new Date(currentDate.getTime() + daysToMilliseconds(p.leadTime)) > p.seasonEndDate;
		const isOutOfSeason = p.seasonStartDate > currentDate;

		if (leadTimeExceeded || isOutOfSeason) {
			this.ns.sendOutOfStockNotification(p.name);
			p.available = 0;
			await this.updateProduct(p);
		} else {
			await this.notifyDelay(p.leadTime, p);
		}
	}

	/**
	 * Handles expired product availability.
	 */
	public async handleExpiredProduct(p: Product): Promise<void> {
		const currentDate = new Date();

		if (!p.expiryDate) {
			// this.ns.sendExpirationNotification(p.name, null);
			return;
		}

		const isExpired = p.expiryDate <= currentDate;

		if (p.available > 0 && !isExpired) {
			p.available -= 1;
		} else {
			this.ns.sendExpirationNotification(p.name, p.expiryDate);
			p.available = 0;
		}

		await this.updateProduct(p);
	}
}
