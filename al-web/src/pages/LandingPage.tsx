import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Mark } from '../components/Mark';

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return diagonal ? (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M4 16 16 4M6 4h10v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M2.5 10h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

function useReveal() {
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -36px 0px' });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

function useScrollProgress() {
  const progress = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        const distance = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = distance > 0 ? window.scrollY / distance : 0;
        if (progress.current) progress.current.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
        frame = 0;
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return progress;
}

function Navigation() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <nav className="site-nav wrap" aria-label="Main navigation">
        <Link className="brand-link" to="/" aria-label="Agentic Lender home" onClick={() => setOpen(false)}><Mark light /></Link>
        <button className="menu-toggle" type="button" aria-expanded={open} aria-controls="site-links" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>
          <span /><span />
        </button>
        <div className={`site-links ${open ? 'site-links-open' : ''}`} id="site-links">
          <a href="#approach" onClick={() => setOpen(false)}>The approach</a>
          <a href="#experience" onClick={() => setOpen(false)}>The experience</a>
          <Link to="/portal" onClick={() => setOpen(false)}>Portal preview</Link>
          <Link className="nav-cta" to="/login" onClick={() => setOpen(false)}>Sign in <Arrow diagonal /></Link>
        </div>
      </nav>
    </header>
  );
}

function DecisionVisual() {
  return (
    <div className="decision-visual" aria-label="Illustration of an application moving from borrower through broker review to underwriter decision" role="img">
      <div className="decision-orbit orbit-one" /><div className="decision-orbit orbit-two" />
      <div className="decision-axis" />
      <div className="decision-point point-one"><span>01</span><strong>Borrower</strong><small>One clear application</small></div>
      <div className="decision-point point-two"><span>02</span><strong>Broker</strong><small>One place to follow up</small></div>
      <div className="decision-point point-three"><span>03</span><strong>Underwriter</strong><small>Reasons alongside the decision</small></div>
      <div className="decision-center"><span className="decision-center-inner">AL</span></div>
      <span className="visual-caption">A visible line from first question to final review</span>
    </div>
  );
}

function ProcessLine() {
  const steps = [
    { number: '01', label: 'Apply', copy: 'A borrower sees what is needed and what happens next.' },
    { number: '02', label: 'Review', copy: 'A broker can find the right file, document, and conversation.' },
    { number: '03', label: 'Decide', copy: 'An underwriter sees the evidence and records a human decision.' },
  ];
  return (
    <div className="process-line" role="list">
      {steps.map((step) => <div className="process-step" key={step.number} role="listitem" data-reveal>
        <span className="step-number">{step.number} / 03</span>
        <span className="step-dot" aria-hidden="true" />
        <h3>{step.label}</h3>
        <p>{step.copy}</p>
      </div>)}
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="product-composition" data-reveal>
      <div className="product-backdrop-word" aria-hidden="true">ONE VIEW</div>
      <div className="product-frame">
        <div className="product-topline"><Mark /><span>My work　　Applications　　Team</span><span>NK</span></div>
        <div className="product-content">
          <div className="product-head"><div><small>THE BROKER WORKSPACE</small><strong>Good morning, Nikoloz.</strong><span>The applications that need you today.</span></div><span className="product-count">03 <i>in your queue</i></span></div>
          <div className="product-rule" />
          <div className="product-list-head"><span>YOUR NEXT STEPS</span><span>REVIEW ORDER ↗</span></div>
          <div className="product-row"><span>AM</span><strong>Aisling Murphy<small>First-time buyer · AL-1048</small></strong><em>€320,000</em><b>Ready for review</b></div>
          <div className="product-row"><span>SP</span><strong>Samir Patel<small>Home mover · AL-1046</small></strong><em>€410,000</em><b className="warm">Needs documents</b></div>
          <div className="product-row"><span>MB</span><strong>Maeve Byrne<small>Home equity · AL-1042</small></strong><em>€85,000</em><b>In review</b></div>
        </div>
      </div>
      <div className="product-index"><span>FIG. 01</span><span>THE BROKER WORKSPACE · PREVIEW</span></div>
    </div>
  );
}

export function LandingPage() {
  useReveal();
  const progress = useScrollProgress();
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <span className="scroll-progress" ref={progress} aria-hidden="true" />
    <Navigation />
    <main id="main">
      <section className="hero" aria-labelledby="hero-heading">
        <div className="hero-grain" aria-hidden="true" />
        <div className="wrap hero-inner">
          <div className="hero-copy">
            <p className="eyebrow light-eyebrow"><span className="eyebrow-line" /> A BETTER VIEW OF LENDING</p>
            <h1 id="hero-heading">Clarity is a <em>kind of</em> confidence<span className="hero-period">.</span></h1>
            <div className="hero-bottom"><p>A considered mortgage journey for the people applying, the people guiding, and the people deciding.</p><a className="round-arrow" href="#approach" aria-label="Explore the approach"><Arrow /></a></div>
          </div>
          <DecisionVisual />
        </div>
        <div className="hero-foot wrap"><span>AGENTIC LENDER / 2026</span><span>SCROLL TO EXPLORE ↓</span><span>DESIGNED FOR HUMAN DECISIONS</span></div>
      </section>

      <section className="manifesto section-pad" id="approach" aria-labelledby="manifesto-heading">
        <div className="wrap manifesto-grid">
          <p className="eyebrow" data-reveal><span className="eyebrow-line" /> THE APPROACH</p>
          <div><h2 id="manifesto-heading" data-reveal>Every application has a story.<br /><em>Make the next step obvious.</em></h2><div className="manifesto-bottom" data-reveal><p>Mortgage decisions involve people, documents, questions, and judgment. Our prototype brings that work into one calm, traceable journey.</p><span className="section-number">01 / 03</span></div></div>
        </div>
      </section>

      <section className="journey section-pad" aria-labelledby="journey-heading">
        <div className="wrap"><div className="section-intro" data-reveal><p className="eyebrow"><span className="eyebrow-line" /> THE JOURNEY</p><h2 id="journey-heading">A line you can follow.</h2><p>Clear handoffs make complex work easier to understand.</p></div><ProcessLine /></div>
      </section>

      <section className="experience section-pad" id="experience" aria-labelledby="experience-heading">
        <div className="wrap"><div className="experience-top" data-reveal><div><p className="eyebrow light-eyebrow"><span className="eyebrow-line" /> BUILT AROUND THE WORK</p><h2 id="experience-heading">Less noise.<br /><em>More context.</em></h2></div><p>One focused view for the files that need attention. The detail is there when you need it, and quiet when you do not.</p></div><ProductPreview /><div className="experience-bottom"><span>Designed as a working prototype</span><Link to="/portal" className="text-link">Explore the portal preview <Arrow diagonal /></Link></div></div>
      </section>

      <section className="closing section-pad" aria-labelledby="closing-heading">
        <div className="wrap closing-inner"><p className="eyebrow" data-reveal><span className="eyebrow-line" /> WHAT COMES NEXT</p><h2 id="closing-heading" data-reveal>Good decisions begin with a <em>clearer view.</em></h2><div className="closing-row" data-reveal><p>Explore the interface and see how the story comes together.</p><Link to="/portal" className="closing-link">Enter the preview <Arrow diagonal /></Link></div></div>
      </section>
    </main>
    <footer className="site-footer"><div className="wrap"><Mark light /><span>Student product prototype · Fictional sample records · No lending service is offered</span><a href="#main">Back to top ↑</a></div></footer>
  </>;
}
