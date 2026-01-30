CREATE DATABASE IF NOT EXISTS yaso CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE yaso;

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL, -- 'compress', 'remove-bg', 'video-remove-bg'
  status VARCHAR(20) NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
  original_filename VARCHAR(255) NOT NULL,
  original_file_path VARCHAR(255) NOT NULL,
  processed_file_path VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
