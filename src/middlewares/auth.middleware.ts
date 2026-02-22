import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const verifyToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Không có token' });
  }

  const token = authHeader.split(' ')[1];

 try {
    // THAY THẾ DÒNG NÀY: Cung cấp luôn một chìa khóa dự phòng phòng hờ file .env bị lỗi
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'Nhozmin123');
    
    (req as any).user = decoded;
    next();
  } catch (error) {
    // THÊM DÒNG CONSOLE.LOG NÀY ĐỂ XEM LỖI THỰC SỰ LÀ GÌ
    console.error("==== LỖI GIẢI MÃ TOKEN ====");
    console.error(error); 
    console.error("Token nhận được:", token);
    console.error("JWT_SECRET đang dùng:", process.env.JWT_SECRET);
    console.error("===========================");
    
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }
};
// Hàm kiểm tra quyền Admin
export const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  // Lấy thông tin user đã được 'verifyToken' giải mã và gắn vào req
  const user = (req as any).user;

  // Kiểm tra xem user có tồn tại và có role là ADMIN không
  // Lưu ý: Chữ "ADMIN" phải viết hoa/thường khớp với dữ liệu trong Database của bạn
  if (user && (user.role === 'ADMIN' || user.role === 'admin')) {
    next(); // Hợp lệ, cho phép đi tiếp đến controller duyệt đơn
  } else {
    // Không phải Admin thì chặn lại
    return res.status(403).json({ 
      success: false, 
      message: 'Quyền truy cập bị từ chối: Chỉ dành cho quản trị viên!' 
    });
  }
};