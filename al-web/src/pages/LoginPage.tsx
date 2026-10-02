import { Link } from 'react-router';
import { Mark } from '../components/Mark';

export function LoginPage() {
  return <main className="auth-page">
    <div className="auth-story">
      <Link to="/" aria-label="Agentic Lender home"><Mark light /></Link>
      <div><p className="eyebrow light-eyebrow"><span className="eyebrow-line" /> THE WORKSPACE</p><h1>Keep the full picture <em>in view.</em></h1><p>One quiet place for applications, documents, and the next conversation.</p></div>
      <span>AGENTIC LENDER / PORTAL</span>
    </div>
    <div className="auth-form-wrap"><div className="auth-form"><Link to="/" className="auth-back">← Back to home</Link><p className="eyebrow"><span className="eyebrow-line" /> BROKER & UNDERWRITER ACCESS</p><h2>Welcome back.</h2><p>Sign-in will connect to Firebase Auth as the portal is built. You can explore the interface now with fictional records.</p><form onSubmit={(event) => event.preventDefault()}><label htmlFor="email">Email address</label><input id="email" type="email" placeholder="you@example.com" autoComplete="email" disabled aria-describedby="auth-note" /><label htmlFor="password">Password</label><input id="password" type="password" placeholder="Password" autoComplete="current-password" disabled aria-describedby="auth-note" /><p id="auth-note" className="auth-note">Account sign-in is not active in this prototype.</p></form><Link className="auth-preview-link" to="/portal">Explore the portal preview <span aria-hidden="true">↗</span></Link></div></div>
  </main>;
}
