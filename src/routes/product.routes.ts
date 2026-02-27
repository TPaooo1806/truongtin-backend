import { Router } from 'express';
import multer from 'multer'; // <-- ĐÃ THÊM MULTER
import * as productController from '../controllers/product.controller';
import * as categoryController from '../controllers/category.controller';
import * as searchController from '../controllers/search.controller';
import * as reviewController from '../controllers/review.controller';

import { verifyToken, isAdmin } from '../middlewares/auth.middleware'; 

// Cấu hình multer lưu file vào RAM (bộ nhớ tạm)
const upload = multer({ storage: multer.memoryStorage() }); // <-- ĐÃ THÊM

const router = Router();

// --- NHÁNH DANH MỤC ---
router.get('/categories', categoryController.getCategories);
router.post('/categories', verifyToken, isAdmin, categoryController.createCategory);
router.delete('/categories/:id', verifyToken, isAdmin, categoryController.deleteCategory);

// --- NHÁNH TÌM KIẾM ---
router.get('/search/suggest', searchController.suggestProducts);

// --- NHÁNH SẢN PHẨM ---
// Khách hàng xem danh sách sản phẩm
router.get('/products', productController.getProducts);

// ==========================================
// ĐÃ THÊM: 2 ROUTE IMPORT (PHẢI ĐẶT TRƯỚC :slug)
// ==========================================
router.get('/products/template', productController.getImportTemplate);
router.post('/products/import', verifyToken, isAdmin, upload.single('file'), productController.importProductsFromExcel);

// Khách hàng xem chi tiết 1 sản phẩm
router.get('/products/:slug', productController.getProductBySlug); 

// Admin Thêm, Sửa, Xóa sản phẩm
router.post('/products', verifyToken, isAdmin, productController.createProduct);      
router.put('/products/:id', verifyToken, isAdmin, productController.updateProduct);    
router.delete('/products/:id', verifyToken, isAdmin, productController.deleteProduct); 

// --- NHÁNH BÌNH LUẬN ---
router.get('/products/:id/reviews', reviewController.getProductReviews);
router.post('/reviews', verifyToken, reviewController.createReview);

export default router;