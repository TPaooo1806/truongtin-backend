import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import * as categoryController from '../controllers/category.controller';
import * as searchController from '../controllers/search.controller';
import * as reviewController from '../controllers/review.controller';
import { verifyToken } from '../middlewares/auth.middleware';

const router = Router();

// --- NHÁNH DANH MỤC ---
router.get('/categories', categoryController.getCategories);
router.post('/categories', categoryController.createCategory);
router.delete('/categories/:id', categoryController.deleteCategory);

// --- NHÁNH TÌM KIẾM (ĐẶT TRƯỚC NHÁNH SẢN PHẨM) ---
// Khớp với Frontend: axios.get('/api/search/suggest')
router.get('/search/suggest', searchController.suggestProducts);

// --- NHÁNH SẢN PHẨM ---
// Lưu ý: Đổi tất cả về tiền tố /products để khớp với Frontend gọi
router.get('/products', productController.getProducts);
router.get('/products/:slug', productController.getProductBySlug); // Route có :slug nên phải nằm dưới cùng của nhánh GET
router.post('/products', productController.createProduct);      // Khớp với api.post('/api/products')
router.put('/products/:id', productController.updateProduct);    // Khớp với api.put('/api/products/...')
router.delete('/products/:id', productController.deleteProduct); // Khớp với api.delete('/api/products/...')

// 1. Route lấy bình luận (Ai cũng xem được, không cần token)
// Trùng khớp với frontend gọi: axios.get('/api/products/${product.id}/reviews')
router.get('/products/:id/reviews', reviewController.getProductReviews);

// 2. Route gửi bình luận (BẮT BUỘC ĐÃ ĐĂNG NHẬP -> Gọi middleware verifyToken)
// Trùng khớp với frontend gọi: axios.post('/api/reviews', ...)
router.post('/reviews', verifyToken, reviewController.createReview);

export default router;