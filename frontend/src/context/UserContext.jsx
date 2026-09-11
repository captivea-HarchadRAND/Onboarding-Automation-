import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user, _setUser] = useState(undefined); // undefined = loading
  const [mockMode, setMockMode] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Wrapper : chaque fois qu'un user est posé (login direct, après 2FA, accept-invite...),
  // on rafraîchit isSuperAdmin depuis le serveur — évite de dupliquer cette logique dans
  // chaque écran qui pose le user après une étape d'auth différente.
  function setUser(nextUser) {
    _setUser(nextUser);
    if (nextUser) {
      api.get('/api/auth/me')
        .then(data => setIsSuperAdmin(data.isSuperAdmin === true))
        .catch(() => setIsSuperAdmin(false));
    } else {
      setIsSuperAdmin(false);
    }
  }

  useEffect(() => {
    api.get('/api/auth/me')
      .then(data => { _setUser(data.user); setMockMode(data.mock === true); setIsSuperAdmin(data.isSuperAdmin === true); })
      .catch(() => _setUser(null));
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
    setIsSuperAdmin(false);
  }

  return (
    <UserContext.Provider value={{ user, setUser, login, logout, mockMode, isSuperAdmin }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
