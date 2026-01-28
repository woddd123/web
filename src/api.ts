const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const API_URL = `${BASE_URL}/api`;

export interface Task {
  id: number;
  type: 'compress' | 'remove-bg' | 'video-remove-bg' | 'writing';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  original_filename: string;
  original_file_path: string;
  processed_file_path: string | null;
  created_at: string;
}

export const api = {
  getTasks: async (): Promise<Task[]> => {
    const res = await fetch(`${API_URL}/tasks`);
    if (!res.ok) throw new Error('Failed to fetch tasks');
    return res.json();
  },

  createTask: async (type: string, file: File): Promise<Task> => {
    const formData = new FormData();
    formData.append('type', type);
    formData.append('file', file);

    const res = await fetch(`${API_URL}/tasks`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to create task');
    return res.json();
  },

  updateTask: async (id: number, status?: string, processedFile?: Blob | File): Promise<Task> => {
    const formData = new FormData();
    if (status) formData.append('status', status);
    if (processedFile) {
      if (processedFile instanceof File) {
        formData.append('file', processedFile);
      } else {
        const type = processedFile.type || 'image/png';
        const ext = type.split('/')[1]?.split(';')[0] || 'png';
        formData.append('file', processedFile, `processed.${ext}`);
      }
    }

    const res = await fetch(`${API_URL}/tasks/${id}`, {
      method: 'PUT',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to update task');
    return res.json();
  },
  
  getFileUrl: (path: string) => {
    return `${BASE_URL}${path}`;
  },

  deleteTask: async (id: number): Promise<void> => {
    const res = await fetch(`${API_URL}/tasks/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete task');
  }
};
