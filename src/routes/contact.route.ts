import { Router } from "express";
import { submitContact, getAllContacts, resolveContact} from "../controllers/contact.controller";
// Nếu bạn có middleware kiểm tra Admin (như verifyToken, isAdmin), bạn có thể import vào đây

const router = Router();

// Route cho khách hàng gửi form (Ai cũng gửi được)
router.post("/", submitContact);

// Route cho Admin xem danh sách (Có thể kẹp thêm middleware admin vào đây sau)
router.get("/admin/all", getAllContacts); 

router.patch("/resolve/:id", resolveContact);
export default router;