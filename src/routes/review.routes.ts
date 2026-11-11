import { Router } from 'express';
import { 
  getProductReviews, 
  createReview, 
  getAdminReviews, 
  updateReviewStatus, 
  deleteReview 
} from '../controllers/review.controller';
import { verifyToken, isAdmin } from '../middlewares/auth.middleware';

const router = Router();

// Public: Xem danh sách đánh giá theo sản phẩm
router.get('/product/:id', getProductReviews);

// Public/User: Gửi đánh giá mới (Hỗ trợ cả người dùng đã đăng nhập hoặc khách)
router.post('/', (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return verifyToken(req, res, next);
  }
  next();
}, createReview);

// Admin: Quản lý danh sách đánh giá
router.get('/admin', verifyToken, isAdmin, getAdminReviews);
router.put('/admin/:id/status', verifyToken, isAdmin, updateReviewStatus);
router.delete('/admin/:id', verifyToken, isAdmin, deleteReview);

export default router;

