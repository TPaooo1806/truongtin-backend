import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import * as categoryController from '../controllers/category.controller';
import * as searchController from '../controllers/search.controller';
import * as reviewController from '../controllers/review.controller';

// BƯỚC 1: QUAN TRỌNG - Import thêm isAdmin vào đây
import { verifyToken, isAdmin } from '../middlewares/auth.middleware'; 

const router = Router();

// --- NHÁNH DANH MỤC ---
// Khách hàng xem danh mục -> Không cần khóa
router.get('/categories', categoryController.getCategories);

// Admin Thêm, Xóa danh mục -> BẮT BUỘC KHÓA
router.post('/categories', verifyToken, isAdmin, categoryController.createCategory);
router.delete('/categories/:id', verifyToken, isAdmin, categoryController.deleteCategory);


// --- NHÁNH TÌM KIẾM (ĐẶT TRƯỚC NHÁNH SẢN PHẨM) ---
// Khách hàng tìm kiếm -> Không cần khóa
router.get('/search/suggest', searchController.suggestProducts);


// --- NHÁNH SẢN PHẨM ---
// Khách hàng xem sản phẩm -> Không cần khóa
router.get('/products', productController.getProducts);
router.get('/products/:slug', productController.getProductBySlug); 

// Admin Thêm, Sửa, Xóa sản phẩm -> BẮT BUỘC KHÓA
router.post('/products', verifyToken, isAdmin, productController.createProduct);      
router.put('/products/:id', verifyToken, isAdmin, productController.updateProduct);    
router.delete('/products/:id', verifyToken, isAdmin, productController.deleteProduct); 


// --- NHÁNH BÌNH LUẬN ---
// 1. Lấy bình luận (Ai cũng xem được, không cần token)
router.get('/products/:id/reviews', reviewController.getProductReviews);

// 2. Gửi bình luận (Chỉ cần đăng nhập là được, không cần phải là Admin)
router.post('/reviews', verifyToken, reviewController.createReview);

export default router;