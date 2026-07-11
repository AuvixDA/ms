import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AtSign, Lock, Mail, User, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(email, password, name, username.trim().toLowerCase());
      navigate(searchParams.get('next') || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center neon-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="glass-card rounded-2xl p-8 w-full max-w-sm shadow-2xl animate-fade-in"
      >
        <h1 className="text-2xl font-semibold mb-1 text-white tracking-wide">Регистрация</h1>
        <p className="text-sm text-white/40 mb-6">Создайте новый аккаунт</p>
        {error && (
          <p className="text-rose-400 text-sm mb-4 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <div className="relative mb-3">
          <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            type="text"
            placeholder="Имя"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="glass-input w-full pl-9 pr-3 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
            required
          />
        </div>
        <div className="relative mb-3">
          <AtSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            type="text"
            placeholder="Юзернейм (например ivan228)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            pattern="[a-zA-Z0-9_]{3,20}"
            title="3-20 символов: латинские буквы, цифры, подчёркивание"
            className="glass-input w-full pl-9 pr-3 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
            required
          />
        </div>
        <div className="relative mb-3">
          <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="glass-input w-full pl-9 pr-3 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
            required
          />
        </div>
        <div className="relative mb-5">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="glass-input w-full pl-9 pr-3 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
            required
            minLength={6}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-br from-violet-600 to-cyan-500 text-[#fff] py-2.5 rounded-full font-medium shadow-glow-violet hover:brightness-110 disabled:opacity-50 transition-all duration-300"
        >
          <UserPlus size={17} />
          {loading ? 'Создаём...' : 'Зарегистрироваться'}
        </button>
        <p className="text-sm text-white/40 mt-5 text-center">
          Уже есть аккаунт?{' '}
          <Link
            to={searchParams.get('next') ? `/login?next=${encodeURIComponent(searchParams.get('next'))}` : '/login'}
            className="text-cyan-300 hover:text-cyan-200 transition-colors duration-300"
          >
            Войти
          </Link>
        </p>
      </form>
    </div>
  );
}
