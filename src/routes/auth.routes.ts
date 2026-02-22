import { Router } from 'express';
import { register, login } from '../controllers/auth.controller';

const router = Router();

/**
 * ĐƯỜNG DẪN ĐĂNG KÝ
 * URL: http://localhost:5000/api/auth/register
 */
router.post('/register', register);

/**
 * ĐƯỜNG DẪN ĐĂNG NHẬP
 * URL: http://localhost:5000/api/auth/login
 */
router.post('/login', login);

export default router;