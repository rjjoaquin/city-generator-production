'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, HelpCircle, Minus, Plus, RotateCcw, Settings2, Sparkles, X } from 'lucide-react'
import { City, CityConfig, CitySize, defaultConfig, generateCity, interpretPrompt, presets } from '@/lib/city-generator'
import { lerp, pointInPolygon } from '@/lib/city/geometry'

const zoneColors = { residential: '#6f8594', commercial: '#c99a52', industrial: '#a86f62' }
const hash = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x) }
const hashStr = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }

function CityCanvas({ city, camera, setCamera }: { city: City; camera: { x: number; y: number; zoom: number }; setCamera: React.Dispatch<React.SetStateAction<{ x: number; y: number; zoom: number }>> }) {
  const ref = useRef<HTMLCanvasElement>(null); const drag = useRef({ x: 0, y: 0, cx: 0, cy: 0, active: false })
  useEffect(() => { const canvas = ref.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return; const dpr = window.devicePixelRatio || 1; const w = window.innerWidth, h = window.innerHeight; canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#11191f'; ctx.fillRect(0, 0, w, h); ctx.save(); ctx.translate(w / 2 + camera.x, h / 2 + camera.y); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-city.mapSize / 2, -city.mapSize / 2)
    ctx.fillStyle = '#20332f'; ctx.fillRect(0, 0, city.mapSize, city.mapSize)
    ctx.strokeStyle = 'rgba(104, 143, 125, .13)'; ctx.lineWidth = 1 / camera.zoom; for (let i = 0; i < city.mapSize; i += 80) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, city.mapSize); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(city.mapSize, i); ctx.stroke() }

    // development envelope — the developed area reads as a distinct irregular region, not the map rectangle
    ctx.beginPath(); city.envelope.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath()
    ctx.fillStyle = 'rgba(53, 74, 66, .55)'; ctx.fill()
    ctx.strokeStyle = 'rgba(178, 190, 158, .16)'; ctx.lineWidth = 2 / camera.zoom; ctx.stroke()

    city.water.forEach(poly => { ctx.beginPath(); poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fillStyle = '#23495d'; ctx.fill() })

    // blocks: outer fill up to the road (sidewalk strip), inner "buildable" fill inset from it
    city.blocks.forEach(b => {
      const isPark = b.zone === 'park'
      ctx.beginPath(); b.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath()
      ctx.fillStyle = isPark ? '#3c5a48' : 'rgba(42, 57, 54, .92)'; ctx.fill()
      const inner = b.buildable.length >= 3 ? b.buildable : b.points
      ctx.beginPath(); inner.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath()
      ctx.fillStyle = isPark ? '#4f7658' : 'rgba(35, 48, 46, .9)'; ctx.fill()
    })

    // park texture: deterministic speckles/strokes plus small tree clusters, never a flat green rectangle
    city.parks.forEach(p => {
      const inner = p.buildable.length >= 3 ? p.buildable : p.points
      const minX = Math.min(...inner.map(pt => pt.x)), maxX = Math.max(...inner.map(pt => pt.x))
      const minY = Math.min(...inner.map(pt => pt.y)), maxY = Math.max(...inner.map(pt => pt.y))
      const seedBase = hashStr(p.id)
      const speckles = Math.min(140, Math.max(14, Math.round(Math.abs(p.area) / 300)))
      for (let i = 0; i < speckles; i++) {
        const px = lerp(minX, maxX, hash(seedBase + i * 7.13)), py = lerp(minY, maxY, hash(seedBase + i * 13.71 + 1))
        if (!pointInPolygon(px, py, inner)) continue
        const dark = hash(seedBase + i * 3.3) > 0.5
        ctx.fillStyle = dark ? 'rgba(58, 88, 62, .45)' : 'rgba(190, 208, 140, .28)'
        const a = hash(seedBase + i * 5.1) * Math.PI * 2, len = 2 + hash(seedBase + i * 9.7) * 3
        ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.fillRect(-len / 2, -0.6, len, 1.2); ctx.restore()
      }
      if (Math.abs(p.area) > 6000) {
        const trees = Math.round(Math.abs(p.area) / 4500)
        for (let i = 0; i < trees; i++) {
          const cx = lerp(minX, maxX, hash(seedBase + i * 17.2 + 3)), cy = lerp(minY, maxY, hash(seedBase + i * 19.6 + 4))
          if (!pointInPolygon(cx, cy, inner)) continue
          ctx.fillStyle = 'rgba(66, 98, 70, .8)'
          for (let j = 0; j < 3; j++) ctx.beginPath(), ctx.arc(cx + (hash(seedBase + i + j) - 0.5) * 6, cy + (hash(seedBase + i + j + 9) - 0.5) * 6, 3.4, 0, Math.PI * 2), ctx.fill()
        }
      }
    })

    // buildings: base fill, darker footprint edge, subtle grain, occasional rooftop equipment on taller ones
    city.buildings.forEach(b => {
      ctx.save(); ctx.translate(b.x + b.width / 2, b.y + b.height / 2); ctx.rotate(b.angle)
      ctx.globalAlpha = .72 + hash(b.seed) * 0.16
      ctx.fillStyle = zoneColors[b.zone]; ctx.fillRect(-b.width / 2, -b.height / 2, b.width, b.height)
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(20, 26, 24, .35)'; ctx.lineWidth = 1 / camera.zoom; ctx.strokeRect(-b.width / 2, -b.height / 2, b.width, b.height)
      ctx.fillStyle = 'rgba(230, 220, 183, .18)'; ctx.fillRect(-b.width / 2 + 3, -b.height / 2 + 3, Math.max(2, b.width - 6), 2)
      for (let i = 0; i < 3; i++) {
        const gx = (hash(b.seed + i * 2.1) - 0.5) * b.width * 0.7, gy = (hash(b.seed + i * 3.7) - 0.5) * b.height * 0.7
        ctx.fillStyle = 'rgba(0, 0, 0, .08)'; ctx.fillRect(gx, gy, Math.max(1, b.width * 0.06), Math.max(1, b.height * 0.06))
      }
      if (b.floors >= 6 && hash(b.seed + 5) > 0.4) { ctx.fillStyle = 'rgba(40, 44, 40, .55)'; ctx.fillRect(-b.width * 0.12, -b.height * 0.12, b.width * 0.24, b.height * 0.24) }
      ctx.restore()
    })

    city.roads.forEach(r => {
      ctx.beginPath(); r.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
      ctx.strokeStyle = r.type === 'arterial' ? '#d8c9a3' : r.type === 'collector' ? '#c2ba9c' : '#9e9b85'
      ctx.lineWidth = r.width; ctx.lineCap = 'round'; ctx.stroke()
      ctx.strokeStyle = r.type === 'arterial' ? '#817d6b' : r.type === 'collector' ? '#7c7862' : '#777b70'
      ctx.lineWidth = r.type === 'arterial' ? 1.3 : r.type === 'collector' ? 1 : .7; ctx.stroke()
      if (r.type === 'arterial') { ctx.strokeStyle = 'rgba(60, 55, 40, .5)'; ctx.lineWidth = 1 / camera.zoom; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]) }
    })
    ctx.restore()
  }, [city, camera])
  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); setCamera(c => ({ ...c, zoom: Math.max(.22, Math.min(3.5, c.zoom * (e.deltaY > 0 ? .9 : 1.1))) })) }
  return <canvas ref={ref} onWheel={onWheel} onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, active: true }; e.currentTarget.setPointerCapture(e.pointerId) }} onPointerMove={e => { if (drag.current.active) setCamera(c => ({ ...c, x: drag.current.cx + e.clientX - drag.current.x, y: drag.current.cy + e.clientY - drag.current.y })) }} onPointerUp={() => { drag.current.active = false }} aria-label={`Generated ${city.size} city map`} />
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onClick={onClose}><section className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</section></div> }

export default function Page() {
  const [config, setConfig] = useState<CityConfig>(defaultConfig); const [city, setCity] = useState<City>(() => generateCity(defaultConfig)); const [camera, setCamera] = useState({ x: 0, y: 0, zoom: .52 }); const [prompt, setPrompt] = useState(''); const [modal, setModal] = useState<'settings' | 'instructions' | 'debug' | null>(null); const [status, setStatus] = useState('Ready to explore')
  const generate = useCallback((next = config) => { setStatus('Generating city…'); requestAnimationFrame(() => { setCity(generateCity(next)); setStatus('City generated'); setCamera({ x: 0, y: 0, zoom: window.innerWidth < 700 ? .28 : .52 }) }) }, [config])
  const randomize = () => { const next = { ...config, seed: `NOVA-${Math.floor(Math.random() * 90000 + 10000)}` }; setConfig(next); generate(next) }
  const fit = () => setCamera({ x: 0, y: 0, zoom: Math.min((window.innerWidth - 80) / city.mapSize, (window.innerHeight - 160) / city.mapSize) })
  const submitPrompt = () => { if (!prompt.trim()) return; const next = interpretPrompt(prompt, config); setConfig(next); setPrompt(''); generate(next) }
  return <main className="city-app"><CityCanvas city={city} camera={camera} setCamera={setCamera} /><header className="topbar"><div className="brand"><span className="brand-mark"><Sparkles size={15} /></span><span>GENERATOR</span><span className="brand-divider">/</span><strong>NOVA CITY</strong></div><div className="seed-readout">SEED <b>{city.seed}</b></div></header><div className="hud hud-left"><span className="live-dot" /> {status}</div><div className="hud hud-right"><span>{city.size.toUpperCase()}</span><span className="hud-divider" /><span>{city.stats.roads} ROADS</span><span className="hud-divider" /><span>{city.stats.blocks} BLOCKS</span><span className="hud-divider" /><span>{city.stats.buildings} BUILDINGS</span><span className="hud-divider" /><span>{city.diagnostics.connectedPercent.toFixed(0)}% CONNECTED</span></div><div className="zoom-controls"><button onClick={() => setCamera(c => ({ ...c, zoom: Math.min(3.5, c.zoom * 1.18) }))} aria-label="Zoom in"><Plus size={17} /></button><button onClick={() => setCamera(c => ({ ...c, zoom: Math.max(.22, c.zoom / 1.18) }))} aria-label="Zoom out"><Minus size={17} /></button><button onClick={fit} aria-label="Fit city"><RotateCcw size={15} /></button></div><div className="prompt-wrap"><div className="prompt-label">DESCRIBE A CHANGE</div><div className="prompt-box"><input value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) submitPrompt() }} placeholder="Make the downtown denser…" /><button onClick={submitPrompt} aria-label="Apply prompt"><Sparkles size={17} /></button></div><div className="prompt-hint">Try “add more parks” or “make the streets chaotic”</div></div><nav className="bottom-bar"><button className="primary-button" onClick={() => generate()}><Sparkles size={15} /> Generate</button><button onClick={randomize}>Randomize</button><div className="size-switcher">{(['small', 'medium', 'large'] as CitySize[]).map(s => <button key={s} className={config.size === s ? 'active' : ''} onClick={() => { const next = { ...config, size: s }; setConfig(next); generate(next) }}>{s}</button>)}</div><button onClick={() => setModal('settings')} aria-label="Settings"><Settings2 size={16} /></button><button onClick={() => setModal('debug')} aria-label="Diagnostics"><Activity size={16} /></button><button onClick={() => setModal('instructions')} aria-label="Instructions"><HelpCircle size={16} /></button></nav>{modal === 'debug' && <Modal title="Generation diagnostics" onClose={() => setModal(null)}><div className="info-grid"><div><b>Attempt</b><span>{city.diagnostics.attempt}{city.diagnostics.usedFallback ? ' (fallback skeleton)' : ''}</span></div><div><b>Road segments</b><span>{city.diagnostics.roadSegments} across {city.diagnostics.roadNodes} nodes</span></div><div><b>Connected</b><span>{city.diagnostics.connectedPercent.toFixed(1)}% in main component</span></div><div><b>Raw blocks</b><span>{city.diagnostics.rawBlocks} traced</span></div><div><b>Accepted blocks</b><span>{city.diagnostics.acceptedBlocks} ({city.diagnostics.parks} parks)</span></div><div><b>Parcels</b><span>{city.diagnostics.parcels}</span></div><div><b>Buildings</b><span>{city.diagnostics.buildings}</span></div></div>{city.diagnostics.failureReasons.length > 0 && <p style={{ marginTop: 16, color: '#c99a52' }}>Validation notes: {city.diagnostics.failureReasons.join('; ')}</p>}</Modal>}{modal === 'instructions' && <Modal title="About Nova City" onClose={() => setModal(null)}><p>Nova City is a deterministic procedural playground. Every road, block, park, and building comes from your seed and the current generation settings.</p><div className="info-grid"><div><b>Seeded worlds</b><span>Reuse a seed to reproduce a city exactly.</span></div><div><b>Navigate</b><span>Drag to pan. Scroll to zoom. Use the reset button to fit the map.</span></div><div><b>Scale</b><span>Small is quick and intimate; Large creates a broad urban canvas.</span></div><div><b>Prompts</b><span>Try “more parks”, “grid city”, “coastal city”, or “dense downtown”.</span></div></div></Modal>}{modal === 'settings' && <Modal title="Generation settings" onClose={() => setModal(null)}><label className="field">Seed<input value={config.seed} onChange={e => setConfig(c => ({ ...c, seed: e.target.value }))} /></label><label className="field">Road randomness <input type="range" min="0" max="1" step=".01" value={config.roadRandomness} onChange={e => setConfig(c => ({ ...c, roadRandomness: Number(e.target.value) }))} /></label><label className="field">Downtown density <input type="range" min="0" max="1" step=".01" value={config.downtownDensity} onChange={e => setConfig(c => ({ ...c, downtownDensity: Number(e.target.value) }))} /></label><label className="field">Park ratio <input type="range" min="0" max=".5" step=".01" value={config.parkRatio} onChange={e => setConfig(c => ({ ...c, parkRatio: Number(e.target.value) }))} /></label><label className="toggle"><input type="checkbox" checked={config.riverEnabled} onChange={e => setConfig(c => ({ ...c, riverEnabled: e.target.checked }))} /> Add a river</label><button className="primary-button wide" onClick={() => { setModal(null); generate() }}>Apply settings</button></Modal>}</main>
}
