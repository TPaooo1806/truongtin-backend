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
  private isLoaded: boolean = false;
  private lastUpdate: Date | null = null;
  private loadingPromise: Promise<void> | null = null;

  /**
   * Đánh dấu hết hạn cache khi Admin tạo, cập nhật, xóa sản phẩm.
   * TUYỆT ĐỐI không gọi DB ngay lập tức để tiết kiệm tối đa compute cho Neon.
   */
  invalidateCache() {
    this.isLoaded = false;
    this.cache = [];
    console.log("[CatalogCache] Cache RAM đã được reset (sẽ lazy-load khi khách chat AI).");
  }

  /**
   * Đảm bảo dữ liệu được nạp vào RAM theo cơ chế Lazy Load.
   * Chỉ kích hoạt khi khách thực sự chat AI và Gemini gọi tool search_product.
   */
  async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadingPromise) {
      return this.loadingPromise;
    }
    this.loadingPromise = this.refreshCache().finally(() => {
      this.loadingPromise = null;
    });
    return this.loadingPromise;
  }

  async refreshCache() {
    try {
      console.log("[CatalogCache] Lazy-load: Đang tải danh mục sản phẩm vào RAM...");
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

      this.isLoaded = true;
      this.lastUpdate = new Date();
      console.log(`[CatalogCache] Đã cache thành công ${this.cache.length} sản phẩm vào lúc ${this.lastUpdate.toLocaleTimeString()}`);
    } catch (error) {
      console.error("[CatalogCache] Lỗi khi refresh cache:", error);
    }
  }

  async searchProducts(query: string, limit: number = 5): Promise<CachedProduct[]> {
    await this.ensureLoaded();
    if (!query) return [];
    const normalizedQuery = query.toLowerCase().trim();
    
    const results = this.cache.filter(p => p.name.toLowerCase().includes(normalizedQuery));
    return results.slice(0, limit);
  }

  getCacheStatus() {
    return {
      isLoaded: this.isLoaded,
      totalProducts: this.cache.length,
      lastUpdate: this.lastUpdate
    };
  }
}

export default new CatalogCacheService();
