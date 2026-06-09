import axios from "axios";

const API_BASE_URL = "http://localhost:5000/api";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Automatically inject JWT token into the headers if it exists in local storage
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export const api = {
  // ── Authentication ──────────────────────────────────────────────────────────
  auth: {
    login: async (email, password) => {
      const response = await apiClient.post("/auth/login", { email, password });
      if (response.data.token) {
        localStorage.setItem("token", response.data.token);
      }
      return response.data;
    },
    register: async (username, email, password) => {
      const response = await apiClient.post("/auth/register", { username, email, password });
      if (response.data.token) {
        localStorage.setItem("token", response.data.token);
      }
      return response.data;
    },
    profile: async () => {
      const response = await apiClient.get("/auth/profile");
      return response.data;
    },
    updateProfile: async (formData) => {
      const isFormData = formData instanceof FormData;
      const response = await apiClient.post("/auth/profile/update", formData, {
        headers: {
          "Content-Type": isFormData ? "multipart/form-data" : "application/json"
        }
      });
      return response.data;
    },
    backup: async () => {
      const response = await apiClient.get("/auth/backup", { responseType: "blob" });
      return response.data;
    },
    logout: () => {
      localStorage.removeItem("token");
    },
    isAuthenticated: () => {
      return !!localStorage.getItem("token");
    },
  },

  // ── Photos ──────────────────────────────────────────────────────────────────
  photos: {
    list: async (filters = {}) => {
      const response = await apiClient.get("/photos/", { params: filters });
      return response.data;
    },
    upload: async (file) => {
      const formData = new FormData();
      formData.append("photo", file);
      const response = await apiClient.post("/photos/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      return response.data;
    },
    delete: async (photoId) => {
      const response = await apiClient.delete(`/photos/${photoId}`);
      return response.data;
    },
    search: async (query) => {
      const response = await apiClient.post("/photos/search", { query });
      return response.data;
    },
  },

  // ── Faces / Face Recognition ───────────────────────────────────────────────
  faces: {
    unrecognized: async () => {
      const response = await apiClient.get("/faces/");
      return response.data;
    },
    label: async (faceIdOrIds, name) => {
      const payload = Array.isArray(faceIdOrIds)
        ? { face_ids: faceIdOrIds, name }
        : { face_id: faceIdOrIds, name };
      const response = await apiClient.post("/faces/label", payload);
      return response.data;
    },
    persons: async () => {
      const response = await apiClient.get("/faces/persons");
      return response.data;
    },
    personPhotos: async (personId) => {
      const response = await apiClient.get(`/faces/person/${personId}`);
      return response.data;
    },
    deletePerson: async (personId) => {
      const response = await apiClient.delete(`/faces/person/${personId}`);
      return response.data;
    },
  },

  // ── Albums ──────────────────────────────────────────────────────────────────
  albums: {
    list: async () => {
      const response = await apiClient.get("/albums/");
      return response.data;
    },
    create: async (albumData) => {
      const response = await apiClient.post("/albums/create", albumData);
      return response.data;
    },
  },

  // ── AI Assistant Chat ───────────────────────────────────────────────────────
  chat: {
    send: async (prompt, history = [], photoIds = []) => {
      const response = await apiClient.post("/chat/", { prompt, history, photo_ids: photoIds });
      return response.data;
    },
  },

  // ── Analytics ───────────────────────────────────────────────────────────────
  analytics: {
    dashboard: async () => {
      const response = await apiClient.get("/analytics/dashboard");
      return response.data;
    },
  },
};
