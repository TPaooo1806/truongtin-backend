import { Router } from 'express';
import { getCustomers, updateCustomerType } from '../controllers/customer.controller';
import { verifyToken, isAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', verifyToken, isAdmin, getCustomers);
router.put('/:id/type', verifyToken, isAdmin, updateCustomerType);

export default router;
