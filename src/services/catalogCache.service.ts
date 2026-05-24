import prisma from '../config/prisma';

export interface CachedProduct {
  id: number;
  name: string;
  minPrice: number;
  maxPrice: number;
  stock: number;
  unit: string;
}

class CatalogCacheService {
  private cache: CachedProduct[] = [];
  private lastUpdate: Date | null = null;
  private intervalId: NodeJS.Timeout | null = null;

  async init() {
    await this.refreshCache();
    // Chạy lại mỗi 15 phút (900000 ms)
    if (!this.intervalId) {
      this.intervalId = setInterval(() => this.refreshCache(), 900000);
    }
  }

  async refreshCache() {
    try {
      console.log("[CatalogCache] Bắt đầu refresh dữ liệu sản phẩm...");
      const products = await prisma.product.findMany({
        where: { isVisible: true },
        select: {
          id: true,
          name: true,
          unit: true,
          variants: {
            select: {
              price: true,
              stock: true,
            }
          }
        }
      });

      this.cache = products.map(p => {
        let minPrice = 0;
        let maxPrice = 0;
        let totalStock = 0;

        if (p.variants.length > 0) {
          const prices = p.variants.map(v => v.price);
          minPrice = Math.min(...prices);
          maxPrice = Math.max(...prices);
          totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
        }

        return {
          id: p.id,
          name: p.name,
          minPrice,
          maxPrice,
          stock: totalStock,
          unit: p.unit
        };
      });

      this.lastUpdate = new Date();
      console.log(`[CatalogCache] Đã cache thành công ${this.cache.length} sản phẩm vào lúc ${this.lastUpdate.toLocaleTimeString()}`);
    } catch (error) {
      console.error("[CatalogCache] Lỗi khi refresh cache:", error);
    }
  }

  searchProducts(query: string, limit: number = 5): CachedProduct[] {
    if (!query) return [];
    const normalizedQuery = query.toLowerCase().trim();
    
    // Tìm kiếm các sản phẩm chứa từ khóa (có thể cải thiện bằng regex hoặc loại bỏ dấu tiếng Việt sau này)
    const results = this.cache.filter(p => p.name.toLowerCase().includes(normalizedQuery));
    
    return results.slice(0, limit);
  }

  getCacheStatus() {
    return {
      totalProducts: this.cache.length,
      lastUpdate: this.lastUpdate
    };
  }
}

export default new CatalogCacheService();
