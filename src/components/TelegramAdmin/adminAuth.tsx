// Стан сесії адмінки: хто увійшов і які вкладки йому доступні.
// Спільний для адмінки бота (#telegram-admin) і сторінки шоу (/quiz) — обидві
// живуть на одному токені, різні в них лише екрани входу.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AdminScope } from '../../telegram-bot/adminScopes';
import { AdminProfile, clearAdminToken, getAdminToken, tgApi } from '../../services/telegramApi';

interface AdminAuthValue {
  profile: AdminProfile;
  can: (scope: AdminScope) => boolean;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth використано поза AdminAuthProvider');
  return ctx;
}

interface Props {
  // Екран входу малює викликач — у адмінки він світлий, на сторінці шоу темний.
  renderLogin: (onSuccess: (profile: AdminProfile) => void) => React.ReactNode;
  renderLoading?: () => React.ReactNode;
  children: React.ReactNode;
}

export const AdminAuthProvider: React.FC<Props> = ({ renderLogin, renderLoading, children }) => {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(() => !!getAdminToken());

  // Наявність токена в localStorage ще не означає, що він живий: він міг протухнути
  // або бути відкликаним зміною прав. Тому на старті питаємо сервер.
  useEffect(() => {
    if (!getAdminToken()) return;
    let cancelled = false;
    tgApi
      .me()
      .then(me => {
        if (cancelled) return;
        setProfile({
          login: me.login,
          displayName: me.displayName || me.login,
          isSuper: me.isSuper,
          scopes: me.scopes,
        });
      })
      .catch(() => {
        if (!cancelled) clearAdminToken();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(() => {
    clearAdminToken();
    setProfile(null);
  }, []);

  const can = useCallback(
    (scope: AdminScope) => !!profile && (profile.isSuper || profile.scopes.includes(scope)),
    [profile]
  );

  if (loading) return <>{renderLoading ? renderLoading() : null}</>;
  if (!profile) return <>{renderLogin(setProfile)}</>;

  return (
    <AdminAuthContext.Provider value={{ profile, can, logout }}>{children}</AdminAuthContext.Provider>
  );
};
