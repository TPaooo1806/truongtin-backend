import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Đang tạo 20 sản phẩm mẫu cho Trường Tín...')

  // Dọn dẹp data cũ
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.productVariant.deleteMany()
  await prisma.product.deleteMany()
  await prisma.category.deleteMany()
  await prisma.user.deleteMany()

  // 1. Tạo Danh mục
  const catDen = await prisma.category.create({ data: { name: 'Bóng đèn', slug: 'bong-den' } })
  const catDay = await prisma.category.create({ data: { name: 'Dây điện', slug: 'day-dien' } })
  const catOng = await prisma.category.create({ data: { name: 'Ống nước', slug: 'ong-nuoc' } })
  const catPhuKien = await prisma.category.create({ data: { name: 'Phụ kiện ống', slug: 'phu-kien-ong' } })
  const catVeSinh = await prisma.category.create({ data: { name: 'Thiết bị vệ sinh', slug: 'thiet-bi-ve-sinh' } })
  const catKimKhi = await prisma.category.create({ data: { name: 'Đồ kim khí', slug: 'do-kim-khi' } })

  // 2. Danh sách 20 sản phẩm
  const products = [
    // BÓNG ĐÈN
    { name: 'Bóng búp LED Hoàng Hải 20W', cat: catDen.id, unit: 'Cái', price: 25000, sku: 'HH-20W' },
    { name: 'Bóng búp LED Hoàng Hải 30W', cat: catDen.id, unit: 'Cái', price: 35000, sku: 'HH-30W' },
    { name: 'Bóng LED trụ Philips 40W', cat: catDen.id, unit: 'Cái', price: 125000, sku: 'PH-40W' },
    { name: 'Đèn tuýp LED 1m2 Nanoco', cat: catDen.id, unit: 'Bộ', price: 95000, sku: 'NA-120' },
    
    // DÂY ĐIỆN
    { name: 'Dây điện đơn Cadivi 1.5 Red', cat: catDay.id, unit: 'Cuộn', price: 450000, sku: 'CV-1.5R' },
    { name: 'Dây điện đơn Cadivi 2.5 Blue', cat: catDay.id, unit: 'Cuộn', price: 720000, sku: 'CV-2.5B' },
    { name: 'Dây đôi mềm Daphaco 2x16', cat: catDay.id, unit: 'Mét', price: 8500, sku: 'DP-216' },
    { name: 'Ổ cắm dây Lioa 3 lỗ 3m', cat: catDay.id, unit: 'Cái', price: 65000, sku: 'LI-33' },

    // ỐNG NƯỚC
    { name: 'Ống nhựa PVC Bình Minh Φ21', cat: catOng.id, unit: 'Cây (4m)', price: 28000, sku: 'BM-21' },
    { name: 'Ống nhựa PVC Bình Minh Φ27', cat: catOng.id, unit: 'Cây (4m)', price: 42000, sku: 'BM-27' },
    { name: 'Ống nhựa PVC Bình Minh Φ34', cat: catOng.id, unit: 'Cây (4m)', price: 55000, sku: 'BM-34' },
    { name: 'Ống gân xoắn chịu lực Φ50', cat: catOng.id, unit: 'Cuộn', price: 1200000, sku: 'GX-50' },

    // PHỤ KIỆN
    { name: 'Co 90 nhựa PVC Φ21', cat: catPhuKien.id, unit: 'Cái', price: 2000, sku: 'CO-21' },
    { name: 'Tê đều nhựa PVC Φ27', cat: catPhuKien.id, unit: 'Cái', price: 5000, sku: 'TE-27' },
    { name: 'Van bi nhựa tay gạt Φ21', cat: catPhuKien.id, unit: 'Cái', price: 15000, sku: 'VAN-21' },
    { name: 'Keo dán ống Bình Minh 1kg', cat: catPhuKien.id, unit: 'Lon', price: 185000, sku: 'KEO-1K' },

    // VỆ SINH & KIM KHÍ
    { name: 'Vòi xịt vệ sinh Inox 304', cat: catVeSinh.id, unit: 'Bộ', price: 145000, sku: 'XIT-304' },
    { name: 'Sen tắm nóng lạnh Inax', cat: catVeSinh.id, unit: 'Bộ', price: 1850000, sku: 'SEN-IN' },
    { name: 'Kìm điện đa năng Asaki', cat: catKimKhi.id, unit: 'Cái', price: 95000, sku: 'KIM-AS' },
    { name: 'Búa đóng đinh cán sắt', cat: catKimKhi.id, unit: 'Cái', price: 65000, sku: 'BUA-CS' },
  ]

  for (const p of products) {
    await prisma.product.create({
      data: {
        name: p.name,
        slug: p.name.toLowerCase().replace(/ /g, '-'),
        description: `Sản phẩm chính hãng tại Trường Tín.`,
        unit: p.unit,
        categoryId: p.cat,
        variants: {
          create: [{ name: 'Mặc định', sku: p.sku, price: p.price, stock: 100 }]
        }
      }
    })
  }

  console.log('✅ Đã nạp xong 20 sản phẩm! F5 lại web đi Bảo ơi.')
}

main()
  .then(async () => { await prisma.$disconnect() })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })