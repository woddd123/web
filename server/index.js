const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const iconv = require('iconv-lite');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Helper to fix encoding for non-ASCII filenames (e.g. Chinese)
const fixEncoding = (str) => {
  // 1. Pure ASCII is always fine
  if (/^[\x00-\x7F]*$/.test(str)) {
    return str;
  }

  // 2. Try to fix by reversing Latin1 decoding
  try {
    // Method A: Standard Node Buffer 'latin1' (keeps low 8 bits)
    const bytes = Buffer.from(str, 'latin1');
    const fixed = iconv.decode(bytes, 'utf8');

    // Validate: If the result has no replacement chars, it's likely correct.
    // Also, if the result is much shorter than input (UTF-8 multibyte -> chars), that's a good sign.
    // But simple check: if it decodes without errors (iconv uses replacement char by default)
    
    // We can also try 'binary' which is alias for latin1 in Node buffers usually
    // console.log(`[Encoding] Fixed (Latin1->UTF8): "${fixed}"`);
    
    // Check if it looks like valid UTF-8
    if (!fixed.includes('')) {
        console.log(`[Encoding] Fixed: "${str}" -> "${fixed}"`);
        return fixed;
    }
    
    // If Method A failed (produced ), maybe it was Windows-1252?
    // This handles the 0x80-0x9F range difference
    const bytesWin = iconv.encode(str, 'windows-1252');
    const fixedWin = iconv.decode(bytesWin, 'utf8');
    // console.log(`[Encoding] Fixed (Win1252->UTF8): "${fixedWin}"`);
    
    if (!fixedWin.includes('')) {
        console.log(`[Encoding] Fixed (Win1252): "${str}" -> "${fixedWin}"`);
        return fixedWin;
    }
    
    // Fallback: return the one with fewer errors or just the Latin1 version
    return fixed;

  } catch (e) {
    console.error(`[Encoding] Error fixing encoding:`, e);
    return str;
  }
};

// Configure Multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Fix encoding for the filename on disk as well
    const originalName = fixEncoding(file.originalname);
    cb(null, uniqueSuffix + '-' + originalName);
  }
});

const upload = multer({ storage: storage });

// Initialize DB
async function initDB() {
  try {
    // Check connection
    await db.query('SELECT 1');
    console.log('Database connected successfully');
    
    // Create table if not exists (using schema content essentially)
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        // We don't execute schema here automatically to avoid overwriting or errors if DB exists
        // This is just a check
    }
  } catch (err) {
    console.error('Database connection failed:', err.message);
    console.error('Please ensure MySQL is running and database "yaso" exists.');
  }
}

initDB();

// API Endpoints

// 1. Get all tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create new task (Upload original file)
app.post('/api/tasks', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { type } = req.body;
    // Fix encoding for the database record
    const original_filename = fixEncoding(req.file.originalname);
    const original_file_path = `/uploads/${req.file.filename}`;

    const [result] = await db.query(
      'INSERT INTO tasks (type, status, original_filename, original_file_path) VALUES (?, ?, ?, ?)',
      [type, 'pending', original_filename, original_file_path]
    );

    res.status(201).json({
      id: result.insertId,
      type,
      status: 'pending',
      original_filename,
      original_file_path
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Update task (Upload processed file or update status)
app.put('/api/tasks/:id', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    let processed_file_path = null;

    if (req.file) {
      processed_file_path = `/uploads/${req.file.filename}`;
    }

    const updates = [];
    const values = [];

    if (status) {
      updates.push('status = ?');
      values.push(status);
    }
    if (processed_file_path) {
      updates.push('processed_file_path = ?');
      values.push(processed_file_path);
    }

    if (updates.length === 0) {
      return res.json({ message: 'No updates' });
    }

    values.push(id);
    await db.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);

    // Fetch updated task
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get single task
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM tasks WHERE id = ?', [id]);
    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
