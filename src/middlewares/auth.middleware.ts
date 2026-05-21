import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const verifyToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // [BM-02] Ƭu tiên đọc token từ httpOnly Cookie
  // Fallback về Authorization header để tương thích ngược với các client cũ
  let token = req.cookies?.token;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Không có token' });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET as string;
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch (error) {
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