import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { normalizarCorreoOUsuario } from '../lib/authDominio'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Cuando ya hay sesión (recién ingresó o volvió estando logueado),
  // lo mandamos al inicio, que redirige según su rol.
  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizarCorreoOUsuario(usuario),
      password
    })
    setLoading(false)
    if (error) setError('Usuario o contraseña incorrectos.')
  }

  return (
    <div
      className="min-h-screen relative overflow-hidden flex items-center justify-center px-4"
      style={{
        backgroundColor: '#b3b3b3',
        // La misma malla diagonal del fondo de la app, sobre el gris.
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(184,145,43,0.16) 0, rgba(184,145,43,0.16) 1px, transparent 1px, transparent 42px), ' +
          'repeating-linear-gradient(-45deg, rgba(184,145,43,0.16) 0, rgba(184,145,43,0.16) 1px, transparent 1px, transparent 42px), ' +
          'radial-gradient(circle at 50% 35%, #e0e0e0 0%, #9a9a9a 100%)'
      }}
    >
      <img
        src="/logo.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none select-none absolute inset-0 m-auto w-[85vmin] max-w-2xl opacity-[0.07]"
      />
      <form onSubmit={handleSubmit} className="relative z-10 w-full max-w-sm bg-ink rounded-2xl shadow-2xl border border-brand-700/40 p-8 space-y-4">
        <div className="text-center">
          <img src="/logo.png" alt="KALLOS" className="w-28 h-28 mx-auto object-contain" />
          <p className="font-serif font-semibold text-brand-300 tracking-[0.3em] text-xl mt-1">KALLOS</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-brand-500 mt-1">The order behind the beauty</p>
          <p className="text-sm text-gray-400 mt-3">Ingresa con tu cuenta</p>
        </div>

        {error && (
          <div className="text-sm bg-red-950/60 text-red-300 border border-red-800 rounded-lg p-2">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-300">Usuario o correo</label>
          <input
            type="text"
            required
            autoCapitalize="none"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            className="w-full rounded-lg bg-surface border border-gray-700 text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-gray-300">Contraseña</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-surface border border-gray-700 text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-ink font-semibold rounded-lg py-2 transition"
        >
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>

        <p className="text-center text-sm text-gray-400">
          ¿Eres clienta?{' '}
          <Link to="/registro-cliente" className="text-brand-400 font-medium">Crea tu cuenta</Link>
        </p>
        <p className="text-center text-[11px] text-gray-600">Developed by Vulpex Software SAS</p>
      </form>
    </div>
  )
}
