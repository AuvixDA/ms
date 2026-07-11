import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock, LogIn, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
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
        <h1 className="text-2xl font-semibold mb-1 text-white tracking-wide">Вход</h1>
        <p className="text-sm text-white/40 mb-6">Рады видеть вас снова</p>
        {error && (
          <p className="text-rose-400 text-sm mb-4 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
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
            type={showPassword ? 'text' : 'password'}
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="glass-input w-full pl-9 pr-10 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="icon-btn absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full"
            title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-br from-violet-600 to-cyan-500 text-[#fff] py-2.5 rounded-full font-medium shadow-glow-violet hover:brightness-110 disabled:opacity-50 transition-all duration-300"
        >
          <LogIn size={17} />
          {loading ? 'Входим...' : 'Войти'}
        </button>
        <p className="text-sm text-white/40 mt-5 text-center">
          Нет аккаунта?{' '}
          <Link
            to={searchParams.get('next') ? `/register?next=${encodeURIComponent(searchParams.get('next'))}` : '/register'}
            className="text-cyan-300 hover:text-cyan-200 transition-colors duration-300"
          >
            Зарегистрироваться
          </Link>
        </p>
      </form>
    </div>
  );
}
