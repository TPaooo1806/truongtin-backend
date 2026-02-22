import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'Nhozmin123';

// 1. ĐĂNG KÝ
export const register = async (req: Request, res: Response) => {
  try {
    const { phone, password, name } = req.body;

    // Kiểm tra xem SĐT đã tồn tại chưa
    const existingUser = await prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Số điện thoại này đã được đăng ký!' });
    }

    // Mã hóa mật khẩu
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Tạo user mới
    const newUser = await prisma.user.create({
      data: {
        phone,
        password: hashedPassword,
        name,
        role: 'USER' // Mặc định là khách hàng
      }
    });

    res.status(201).json({ success: true, message: 'Đăng ký thành công!' });
  } catch (error) {
    console.error("Lỗi đăng ký:", error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

// 2. ĐĂNG NHẬP
export const login = async (req: Request, res: Response) => {
  try {
    const { phone, password } = req.body;

    // Tìm user theo số điện thoại
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Số điện thoại hoặc mật khẩu không đúng!' });
    }

    // So sánh mật khẩu
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Số điện thoại hoặc mật khẩu không đúng!' });
    }

    // Tạo Token
    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' } // Đăng nhập tồn tại 7 ngày
    );

    // Xóa password khỏi kết quả trả về Frontend cho an toàn
    const { password: _, ...userData } = user;

    res.status(200).json({
      success: true,
      message: 'Đăng nhập thành công!',
      token,
      data: userData
    });
  } catch (error) {
    console.error("Lỗi đăng nhập:", error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};