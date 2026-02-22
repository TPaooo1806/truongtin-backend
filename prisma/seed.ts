// Add Node.js type definitions for process
/// <reference types="node" />
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Hàm chuyển đổi tiếng Việt có dấu thành Slug không dấu chuẩn SEO
const toSlug = (str: string) => {
  return str
    .toLowerCase()
    .normalize('NFD')                  // Chuẩn hóa Unicode để tách dấu
    .replace(/[\u0300-\u036f]/g, '')   // Xóa các dấu sau khi tách
    .replace(/[đĐ]/g, 'd')             // Thay chữ đ/Đ thành d
    .replace(/([^0-9a-z-\s])/g, '')    // Xóa ký tự đặc biệt
    .replace(/(\s+)/g, '-')            // Thay khoảng trắng bằng dấu gạch ngang
    .replace(/-+/g, '-')               // Lọc bỏ nhiều dấu gạch ngang liên tiếp
    .replace(/^-+|-+$/g, '');          // Cắt bỏ gạch ngang ở đầu và cuối chuỗi
};

async function main() {
  console.log('🌱 Đang dọn dẹp dữ liệu cũ...')

  // Dọn dẹp theo thứ tự để tránh lỗi khóa ngoại (Foreign Key)
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.productVariant.deleteMany()
  await prisma.productImage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.category.deleteMany()
  await prisma.user.deleteMany()

  console.log('🌱 Đang tạo danh mục mẫu...')
  
  // 1. Tạo Danh mục (Dùng hàm toSlug để tự tạo slug từ tên nếu muốn, hoặc fix cứng)
  const categoriesData = [
    { name: 'Bóng đèn', slug: 'bong-den' },
    { name: 'Dây điện', slug: 'day-dien' },
    { name: 'Ống nước', slug: 'ong-nuoc' },
    { name: 'Phụ kiện ống', slug: 'phu-kien-ong' },
    { name: 'Thiết bị vệ sinh', slug: 'thiet-bi-ve-sinh' },
    { name: 'Đồ kim khí', slug: 'do-kim-khi' },
  ]

  const createdCategories = await Promise.all(
    categoriesData.map(cat => prisma.category.create({ data: cat }))
  )

  // Map lại để lấy ID dễ hơn
  const getCatId = (name: string) => createdCategories.find(c => c.name === name)?.id

  console.log('🌱 Đang nạp 20 sản phẩm mẫu cho Trường Tín...')

  // 2. Danh sách sản phẩm
  const products = [
    { name: 'Bóng búp LED Hoàng Hải 20W', cat: 'Bóng đèn', unit: 'Cái', price: 25000, sku: 'HH-20W' },
    { name: 'Bóng búp LED Hoàng Hải 30W', cat: 'Bóng đèn', unit: 'Cái', price: 35000, sku: 'HH-30W' },
    { name: 'Bóng LED trụ Philips 40W', cat: 'Bóng đèn', unit: 'Cái', price: 125000, sku: 'PH-40W' },
    { name: 'Đèn tuýp LED 1m2 Nanoco', cat: 'Bóng đèn', unit: 'Bộ', price: 95000, sku: 'NA-120' },
    
    { name: 'Dây điện đơn Cadivi 1.5 Red', cat: 'Dây điện', unit: 'Cuộn', price: 450000, sku: 'CV-1.5R' },
    { name: 'Dây điện đơn Cadivi 2.5 Blue', cat: 'Dây điện', unit: 'Cuộn', price: 720000, sku: 'CV-2.5B' },
    { name: 'Dây đôi mềm Daphaco 2x16', cat: 'Dây điện', unit: 'Mét', price: 8500, sku: 'DP-216' },
    { name: 'Ổ cắm dây Lioa 3 lỗ 3m', cat: 'Dây điện', unit: 'Cái', price: 65000, sku: 'LI-33' },

    { name: 'Ống nhựa PVC Bình Minh Φ21', cat: 'Ống nước', unit: 'Cây (4m)', price: 28000, sku: 'BM-21' },
    { name: 'Ống nhựa PVC Bình Minh Φ27', cat: 'Ống nước', unit: 'Cây (4m)', price: 42000, sku: 'BM-27' },
    { name: 'Ống nhựa PVC Bình Minh Φ34', cat: 'Ống nước', unit: 'Cây (4m)', price: 55000, sku: 'BM-34' },
    { name: 'Ống gân xoắn chịu lực Φ50', cat: 'Ống nước', unit: 'Cuộn', price: 1200000, sku: 'GX-50' },

    { name: 'Co 90 nhựa PVC Φ21', cat: 'Phụ kiện ống', unit: 'Cái', price: 2000, sku: 'CO-21' },
    { name: 'Tê đều nhựa PVC Φ27', cat: 'Phụ kiện ống', unit: 'Cái', price: 5000, sku: 'TE-27' },
    { name: 'Van bi nhựa tay gạt Φ21', cat: 'Phụ kiện ống', unit: 'Cái', price: 15000, sku: 'VAN-21' },
    { name: 'Keo dán ống Bình Minh 1kg', cat: 'Phụ kiện ống', unit: 'Lon', price: 185000, sku: 'KEO-1K' },

    { name: 'Vòi xịt vệ sinh Inox 304', cat: 'Thiết bị vệ sinh', unit: 'Bộ', price: 145000, sku: 'XIT-304' },
    { name: 'Sen tắm nóng lạnh Inax', cat: 'Thiết bị vệ sinh', unit: 'Bộ', price: 1850000, sku: 'SEN-IN' },
    { name: 'Kìm điện đa năng Asaki', cat: 'Đồ kim khí', unit: 'Cái', price: 95000, sku: 'KIM-AS' },
    { name: 'Búa đóng đinh cán sắt', cat: 'Đồ kim khí', unit: 'Cái', price: 65000, sku: 'BUA-CS' },
  ]

  for (const p of products) {
    await prisma.product.create({
      data: {
        name: p.name,
        slug: toSlug(p.name), // Tạo slug không dấu: "voi-xit-ve-sinh-inox-304"
        description: `Sản phẩm ${p.name} chất lượng cao, phân phối chính hãng tại điện nước Trường Tín.`,
        unit: p.unit,
        categoryId: getCatId(p.cat),
        variants: {
          create: [{ 
            name: 'Mặc định', 
            sku: p.sku, 
            price: p.price, 
            stock: 100 
          }]
        }
      }
    })
  }

  console.log('✅ Đã nạp xong 20 sản phẩm sạch sẽ không dấu!')
  console.log('🚀 Bảo ơi, giờ F5 lại trang chủ rồi bấm vào sản phẩm là chạy nhé!')
}

main()
  .then(async () => { await prisma.$disconnect() })
  .catch(async (e) => { 
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })