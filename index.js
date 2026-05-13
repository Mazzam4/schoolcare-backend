const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

// ==========================================
// Middleware
// ==========================================
app.use(cors());

// Increase the limit for JSON bodies (e.g., to 50MB)
app.use(express.json({ limit: '4mb' })); 

// Also increase the limit for URL-encoded data if needed
app.use(express.urlencoded({ limit: '4mb', extended: true }));
// ==========================================
// 1. API REGISTER (Membuat Akun Baru)
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  try {
    // Cek apakah email sudah terdaftar
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'Email sudah digunakan!' });
    }

    // Hash (acak) password sebelum disimpan
    const hashedPassword = await bcrypt.hash(password, 10);

    // Simpan ke database
    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
      },
    });

    res.status(201).json({ message: 'Akun berhasil dibuat!', userId: newUser.id });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 2. API LOGIN (Masuk & Dapatkan Token)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Cari user berdasarkan email
    const user = await prisma.user.findUnique({ where: { email } });
    
    // Jika user tidak ada
    if (!user) {
      return res.status(404).json({ message: 'Password atau Email salah!' });
    }

    // Cek apakah password cocok
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Password atau Email salah!' });
    }

    // Jika berhasil, buatkan JWT Token
    // Kita simpan id, email, dan role di dalam tokennya
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, organizationId: user.organizationId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // Token berlaku selama 7 hari
    );

    // Kirim balasan ke Flutter beserta datanya (untuk disimpan di HP)
    res.status(200).json({
      message: 'Login berhasil!',
      token: token,
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId
      }
    });

  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// MIDDLEWARE: Cek Token JWT
// ==========================================
// Fungsi ini mengecek apakah request dari Flutter membawa Kunci (Token) yang sah
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

  if (!token) return res.status(401).json({ message: 'Akses ditolak. Token tidak ada!' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Token tidak valid atau sudah kadaluarsa!' });
    req.user = user; // Menyimpan data user (userId, email, dll) dari dalam token
    next(); // Lanjut ke proses berikutnya
  });
};

// ==========================================
// 3. API BUAT ORGANISASI BARU
// ==========================================
app.post('/api/org/create', authenticateToken, async (req, res) => {
  const { name, description } = req.body;
  const userId = req.user.userId; // Didapat dari token

  try {
    // Cek apakah nama organisasi sudah dipakai orang lain
    const existingOrg = await prisma.organization.findUnique({ where: { name } });
    if (existingOrg) {
      return res.status(400).json({ message: 'Nama sekolah sudah terdaftar! Silakan gunakan nama lain.' });
    }

    // 1. Buat organisasi baru di database
    const newOrg = await prisma.organization.create({
      data: { name, description },
    });

    // 2. Update user yang membuat: jadikan dia "guru" dan masukkan ke organisasi tersebut
    await prisma.user.update({
      where: { id: userId },
      data: { 
        role: 'guru', 
        organizationId: newOrg.id 
      },
    });

    res.status(201).json({ message: 'Organisasi berhasil dibuat!', organization: newOrg, newRole: 'guru' });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 4. API GABUNG KE ORGANISASI
// ==========================================
app.post('/api/org/join', authenticateToken, async (req, res) => {
  const { name } = req.body;
  const userId = req.user.userId;

  try {
    // Cari organisasi berdasarkan namanya
    const org = await prisma.organization.findUnique({ where: { name } });
    
    if (!org) {
      return res.status(404).json({ message: 'Sekolah tidak ditemukan! Cek kembali penulisan namanya.' });
    }

    // Update user: masukkan dia ke organisasi tersebut (role tetap default: siswa)
    await prisma.user.update({
      where: { id: userId },
      data: { organizationId: org.id },
    });

    res.status(200).json({ message: 'Berhasil bergabung dengan sekolah!', organization: org });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 5. API UPDATE PROFIL (Nama & Password)
// ==========================================
app.put('/api/user/update', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // Dari token JWT
  const { firstName, lastName, oldPassword, newPassword, profileImage } = req.body;

  try {
    // 1. Cari data user saat ini di database
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan!' });

    let updatedData = {};

    // 2. Jika ada data Nama yang dikirim, masukkan ke daftar update
    if (firstName && lastName) {
      updatedData.firstName = firstName;
      updatedData.lastName = lastName;
    }

    if (profileImage) {
      updatedData.profileImage = profileImage;
    }

    // 3. Jika ada request Ganti Password
    if (oldPassword && newPassword) {
      // Cek apakah password lama yang dimasukkan cocok dengan di database
      const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Password lama salah!' });
      }
      
      // Hash (acak) password baru sebelum disimpan
      updatedData.password = await bcrypt.hash(newPassword, 10);
    }

    // 4. Proses update ke database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updatedData
    });

    res.status(200).json({ 
      message: 'Profil berhasil diperbarui!', 
      user: {
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 6. API BUAT LAPORAN BARU
// ==========================================
app.post('/api/reports/create', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { type, category, location, description, photoBase64, latitude, longitude } = req.body;

  try {
    // Pastikan user ini punya sekolah
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user.organizationId) {
      return res.status(400).json({ message: 'Kamu belum bergabung dengan sekolah manapun!' });
    }

    // Simpan Laporan ke Database
    const newReport = await prisma.report.create({
      data: {
        type,
        category,
        location,
        description,
        photoBase64, // Menyimpan gambar dalam bentuk teks panjang
        latitude,
        longitude,
        authorId: userId,
        organizationId: user.organizationId
      }
    });

    res.status(201).json({ message: 'Laporan berhasil dibuat!', report: newReport });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 7. API GET SEMUA LAPORAN DI ORGANISASI (HANYA 7 HARI TERAKHIR)
// ==========================================
app.get('/api/reports', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true }
    });

    if (!user || !user.organizationId) {
      return res.status(400).json({ message: 'Kamu belum bergabung dengan sekolah manapun!' });
    }

    // Buat batasan waktu: Hari ini dikurangi 7 hari
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const reports = await prisma.report.findMany({
      where: { 
        organizationId: user.organizationId,
        createdAt: {
          gte: sevenDaysAgo // gte = Greater Than or Equal (Lebih besar/sama dengan 7 hari lalu)
        }
      },
      include: {
        author: {
          select: { firstName: true, lastName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      message: 'Berhasil mengambil laporan 7 hari terakhir',
      organizationName: user.organization.name,
      organizationDesc: user.organization.description,
      reports: reports
    });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 8. API UPDATE STATUS LAPORAN (KHUSUS GURU)
// ==========================================
app.put('/api/reports/:id/status', authenticateToken, async (req, res) => {
  const reportId = parseInt(req.params.id);
  const { status } = req.body;
  const userId = req.user.userId;

  try {
    // Cek role user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user.role.toLowerCase() !== 'guru') {
      return res.status(403).json({ message: 'Akses ditolak! Hanya guru yang bisa mengubah status laporan.' });
    }

    // Update status laporan di database
    const updatedReport = await prisma.report.update({
      where: { id: reportId },
      data: { status: status }
    });

    res.status(200).json({ message: 'Status laporan berhasil diperbarui!', report: updatedReport });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 9. API GET LAPORAN SAYA (RIWAYAT PRIBADI)
// ==========================================
app.get('/api/reports/me', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    // Ambil data user + organisasi
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true }
    });

    // Cari laporan user
    const myReports = await prisma.report.findMany({
      where: { authorId: userId },
      include: {
        author: {
          select: { firstName: true, lastName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      message: 'Berhasil mengambil riwayat laporan',
      organizationName: user?.organization?.name ?? "Sekolahmu",
      organizationDesc: user?.organization?.description ?? "",
      reports: myReports
    });

  } catch (error) {
    res.status(500).json({
      message: 'Terjadi kesalahan server.',
      error: error.message
    });
  }
});
// ==========================================
// 10. API DASHBOARD BERANDA (STATISTIK)
// ==========================================
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true }
    });

    if (!user || !user.organizationId) {
      return res.status(400).json({ message: 'Belum bergabung dengan organisasi' });
    }

    const orgId = user.organizationId;

    // 1. Hitung Jumlah Anggota (Siswa + Guru) di organisasi ini
    const totalMembers = await prisma.user.count({ where: { organizationId: orgId } });

    // 2. Ambil data 7 hari terakhir untuk diolah
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // 7 hari termasuk hari ini

    const recentReports = await prisma.report.findMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: sevenDaysAgo }
      },
      include: { author: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' }
    });

    // 3. Olah Data untuk Grafik dan Statistik
    let proses = 0;
    let selesai = 0;
    let fasilitas = 0;
    let kebersihan = 0;
    let todaysReports =[];

    // Siapkan wadah untuk Bar Chart (7 hari kebelakang)
    const dailyCounts = {};
    for (let i = 6; i >= 0; i--) {
      let d = new Date(startOfToday);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dailyCounts[dateStr] = 0;
    }

    recentReports.forEach(r => {
      // Hitung Status
      const status = r.status.toLowerCase();
      if (status.includes('proses')) proses++;
      if (status === 'selesai') selesai++;

      // Hitung Kategori (Pie Chart)
      if (r.type.toLowerCase().includes('fasilitas')) fasilitas++;
      if (r.type.toLowerCase().includes('kebersihan')) kebersihan++;

      // Filter Laporan Khusus Hari Ini
      const rDate = new Date(r.createdAt);
      if (rDate >= startOfToday) {
        todaysReports.push(r);
      }

      // Hitung per hari (Bar Chart)
      const dateStr = rDate.toISOString().split('T')[0];
      if (dailyCounts[dateStr] !== undefined) {
        dailyCounts[dateStr]++;
      }
    });

    // Format Data Bar Chart untuk Flutter
    const daysName =['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const barChartData = Object.keys(dailyCounts).map(dateStr => {
      const d = new Date(dateStr);
      return {
        day: daysName[d.getDay()],
        count: dailyCounts[dateStr]
      };
    });

    res.status(200).json({
      organizationName: user.organization.name,
      organizationDesc: user.organization.description,
      totalMembers: totalMembers,
      stats: {
        total7Days: recentReports.length,
        proses: proses,
        selesai: selesai
      },
      pieChart: {
        fasilitas: fasilitas,
        kebersihan: kebersihan
      },
      barChart: barChartData,
      todaysReports: todaysReports // Mengirimkan HANYA laporan hari ini
    });

  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 11. API GET SEMUA ANGGOTA SEKOLAH
// ==========================================
app.get('/api/org/members', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true }
    });

    if (!user || !user.organizationId) {
      return res.status(400).json({ message: 'Kamu belum bergabung dengan sekolah manapun!' });
    }

    // Ambil semua user yang berada di organisasi yang sama
    const members = await prisma.user.findMany({
      where: { organizationId: user.organizationId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        profileImage: true
      },
      orderBy:[
        { role: 'asc' }, // Guru akan muncul di atas (karena 'g' lebih dulu dari 's')
        { firstName: 'asc' }
      ]
    });

    res.status(200).json({
      organizationName: user.organization.name,
      members: members
    });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// 12. API UPDATE JADIKAN GURU (KHUSUS GURU)
// ==========================================
app.put('/api/org/members/:id/role', authenticateToken, async (req, res) => {
  const adminId = req.user.userId;
  const targetUserId = parseInt(req.params.id);

  try {
    // Pastikan yang menekan tombol ini adalah benar-benar guru
    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (admin.role.toLowerCase() !== 'guru') {
      return res.status(403).json({ message: 'Akses Ditolak! Hanya guru yang bisa mengubah jabatan anggota.' });
    }

    // Update role anggota yang dipilih menjadi guru
    await prisma.user.update({
      where: { id: targetUserId },
      data: { role: 'guru' }
    });

    res.status(200).json({ message: 'Berhasil menjadikan anggota ini sebagai guru!' });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan server.', error: error.message });
  }
});

// ==========================================
// ROBOT CRON JOB: PENGHAPUS LAPORAN KADALUARSA
// ==========================================
// Menjalankan tugas setiap jam 00:00 (Tengah Malam) setiap harinya.
// Format cron: "Menit Jam Tanggal Bulan Hari" -> "0 0 * * *"
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Memulai pengecekan laporan kadaluarsa...');
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Hapus semua laporan yang tanggal dibuatnya (createdAt) KURANG DARI (lt) 7 hari yang lalu
    const deletedReports = await prisma.report.deleteMany({
      where: {
        createdAt: {
          lt: sevenDaysAgo // lt = Less Than
        }
      }
    });

    console.log(`[CRON] Berhasil membersihkan ${deletedReports.count} laporan lama dari database.`);
  } catch (error) {
    console.error('[CRON] Gagal menghapus laporan:', error);
  }
});

// ==========================================
// Menyalakan Server
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server SchoolCare berjalan di http://localhost:${PORT}`);
  console.log('Robot pembersih otomatis (Cron Job) sudah aktif!');
});