import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [mockMode, setMockMode] = useState(false);

  useEffect(() => {
    api.get('/api/auth/me')
      .then(data => { setUser(data.user); setMockMode(data.mock === true); })
      .catch(() => setUser(null));
  }, []);

  async function login(email, password) {
    const data = await api.post('/api/auth/login', { email, password });
    setUser(data.user);
    setMockMode(data.mock === true);
    return data.user;
  }

  async function logout() {
    await api.post('/api/auth/logout');
    setUser(null);
    setMockMode(false);
  }

  return (
    <UserContext.Provider value={{ user, setUser, login, logout, mockMode }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
