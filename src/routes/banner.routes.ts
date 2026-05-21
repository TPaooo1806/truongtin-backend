import { Router } from 'express';
import { getBanners, getActiveBanners, createBanner, toggleBanner, deleteBanner } from '../controllers/banner.controller';
import { verifyToken, isAdmin } from '../middlewares/auth.middleware';

const router = Router();

// GET: Public - Khách và Admin đều xem được
router.get('/', getBanners);
router.get('/active', getActiveBanners);

// POST/PUT/DELETE: Chỉ Admin mới được thao tác
router.post('/', verifyToken, isAdmin, createBanner);
router.put('/:id/toggle', verifyToken, isAdmin, toggleBanner);
router.delete('/:id', verifyToken, isAdmin, deleteBanner);

export default router;
