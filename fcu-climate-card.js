/**
 * FCU Climate Card  v1.3.1
 * ═══════════════════════════════════════════════════════════════
 * Шинэчлэлт v1.3.0:
 *   - Heat горим: arc ЗҮҮНЭЭС дүүрнэ (knob зүүн=min → баруун=max)
 *   - Cool горим: arc БАРУУНААС дүүрнэ (knob баруун=min → зүүн=max)
 *   - Fan горим:  arc ҮРГЭЛЖ ДҮҮРЭН цэнхэр (тохируулга харуулахгүй)
 *   - Унтраасан үед: fan slider + arc drag идэвхгүй
 *   - Горим солих → товч шууд тодорно (optimistic), дугуйн өнгө
 *     sensor баталгаажсаны дараа солигдоно
 *   - Pending timeout: 3 минут (180 сек)
 * ═══════════════════════════════════════════════════════════════
 */

/* ── Arc тогтмол ── */
const CX = 150, CY = 148, R = 120, W = 28;
const A0 = 135, SPAN = 270;        // 135° → 405° (= 45°) clockwise
const AE = A0 + SPAN;              // 405° — arc-ийн баруун төгсгөл
const VW = 300, VH = 290;

const MODES = {
  '0': { label: 'Cool', color: '#1E88E5' },
  '1': { label: 'Heat', color: '#E53935' },
  '2': { label: 'Fan',  color: '#00ACC1' },
};

const STYLES = `
:host { display: block; }
ha-card { overflow: hidden; font-family: var(--primary-font-family, sans-serif); }

.header { padding: 16px 16px 0; }
.title { font-size: 16px; font-weight: 500; color: var(--primary-text-color); }

.body { display: flex; flex-direction: column; align-items: center; padding: 0 12px 0; }

/* ── Arc SVG ── */
.dial {
  width: 100%; max-width: 300px; overflow: visible;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
.dial-mode { font-size: 17px; font-weight: 500; }
.dial-temp { font-size: 64px; font-weight: 300; fill: var(--primary-text-color); }
.dial-unit { font-size: 22px; font-weight: 300; fill: var(--primary-text-color); }
.dial-amb  { font-size: 14px; fill: var(--secondary-text-color); }

/* ── Fan slider ── */
.fan-section { width: 100%; padding: 4px 8px 14px; }
.fan-lbl-row {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: var(--secondary-text-color); margin-bottom: 8px;
}
.fan-speed-val { font-weight: 600; color: var(--primary-text-color); }
.fan-slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 6px; border-radius: 99px;
  outline: none; cursor: pointer; margin: 0; display: block;
}
.fan-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--fan-clr, #1E88E5);
  box-shadow: 0 1px 6px rgba(0,0,0,0.28);
  cursor: grab; transition: transform 0.1s;
}
.fan-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.12); }
.fan-slider::-moz-range-thumb {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--fan-clr, #1E88E5); border: none;
  box-shadow: 0 1px 6px rgba(0,0,0,0.28); cursor: grab;
}
.fan-slider:disabled { opacity: 0.35; pointer-events: none; }
.fan-marks {
  display: flex; justify-content: space-between;
  padding: 5px 2px 0; font-size: 10px;
  color: var(--secondary-text-color);
}

/* ── Горим товч ── */
.mode-row {
  display: flex; width: 100%;
  border-top: 1px solid var(--divider-color, #e0e0e0);
}
.mode-btn {
  flex: 1; padding: 13px 0; border: none; background: transparent;
  cursor: pointer; color: var(--secondary-text-color);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
  -webkit-tap-highlight-color: transparent;
  --mdc-icon-size: 22px;
}
.mode-btn:active { opacity: 0.75; }
`;

class FcuClimateCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config      = null;
    this._hass        = null;
    this._pending     = null;    // optimistic set_temp
    this._pTimer      = null;
    this._pendingMode = null;    // optimistic mode (товч)
    this._mTimer      = null;
    this._dragging    = false;
  }

  setConfig(cfg) {
    if (!cfg.hub)     throw new Error("'hub' шаардлагатай");
    if (!cfg.slave)   throw new Error("'slave' шаардлагатай");
    if (!cfg.sensors) throw new Error("'sensors' шаардлагатай");
    this._config = { min_temp: 16, max_temp: 30, ...cfg };
    this._render();
  }

  set hass(h) {
    this._hass = h;
    if (!this._dragging) this._render();
  }

  /* ── Туслах ── */
  _num(id) {
    if (!id || !this._hass) return null;
    const v = parseFloat(this._hass.states[id]?.state);
    return isNaN(v) ? null : v;
  }

  _write(address, value) {
    this._hass.callService('modbus', 'write_register', {
      hub: this._config.hub, slave: this._config.slave,
      address, value: Math.round(value),
    });
  }

  /* ── Arc тооцоолол ── */
  _pt(deg) {
    const a = (deg * Math.PI) / 180;
    return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
  }

  _arc(a1, a2) {
    const s = this._pt(a1), e = this._pt(a2);
    const large = (a2 - a1) > 180 ? 1 : 0;
    return `M${s.x.toFixed(1)} ${s.y.toFixed(1)} A${R} ${R} 0 ${large} 1 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
  }

  /* ── Горимоор knob байрлал + arc зам тооцоо ── */
  _arcForTemp(setTemp, mKey) {
    const cfg = this._config;
    const ratio = Math.max(0, Math.min(1,
      (setTemp - cfg.min_temp) / (cfg.max_temp - cfg.min_temp)));

    if (mKey === '2') {
      // Fan: arc үргэлж дүүрэн цэнхэр.
      // Knob нь setTemp-ийн байрлалд харагдана (heat чиглэлээр), drag биш.
      const knobAngle = A0 + ratio * SPAN;
      return { arcPath: this._arc(A0, AE), knobAngle, ratio: 1 };
    }
    if (mKey === '0') {
      // Cool: ЗҮҮНААС дүүрнэ (A0 → knob).
      // Knob баруун=min temp, зүүн=max temp.
      // ratio=0 (temp=min) → knobAngle=AE → full arc, knob баруун ✓
      // ratio=1 (temp=max) → knobAngle=A0 → no arc, knob зүүн ✓
      const knobAngle = AE - ratio * SPAN;
      const arcPath = ratio < 0.995 ? this._arc(A0, knobAngle) : null;
      return { arcPath, knobAngle, ratio };
    }
    // Heat: ЗҮҮНААС (A0) → баруун тийш (стандарт)
    const knobAngle = A0 + ratio * SPAN;
    const arcPath = ratio > 0.005 ? this._arc(A0, knobAngle) : null;
    return { arcPath, knobAngle, ratio };
  }

  /* ── Хулганы өнцгөөс температур → горимоор чиглэл тооцно ── */
  _angleToTemp(deg, mKey) {
    const cfg = this._config;
    let r;

    if (deg >= 135)     r = (deg - A0) / SPAN;
    else if (deg <= 45) r = (deg + 225) / SPAN;
    else                r = deg < 90 ? 1 : 0;   // 45°–135° хөрс
    r = Math.max(0, Math.min(1, r));

    // Cool: чиглэл урвуу — баруун(r=1)=min temp, зүүн(r=0)=max temp
    const ratio = mKey === '0' ? 1 - r : r;
    return Math.round(cfg.min_temp + ratio * (cfg.max_temp - cfg.min_temp));
  }

  /* ── Drag үед DOM шинэчлэх (full re-render биш) ── */
  _updateDial(temp) {
    const sr  = this.shadowRoot;
    const cfg = this._config;
    const mode   = this._num(cfg.sensors.mode);
    const mKey   = String(Math.round(mode ?? 1));
    const isOn   = this._num(cfg.sensors.power) === 1;
    const mColor = isOn ? (MODES[mKey] ?? MODES['1']).color : '#9E9E9E';

    if (mKey === '2') return; // Fan: дугуй хэзээ ч хөдлөхгүй (arc үргэлж дүүрэн)

    const { arcPath, knobAngle } = this._arcForTemp(temp, mKey);

    const arcEl  = sr.getElementById('arc-act');
    const knobEl = sr.getElementById('arc-knob');
    const txtEl  = sr.getElementById('temp-txt');

    if (arcEl) {
      if (arcPath) {
        arcEl.setAttribute('d', arcPath);
        arcEl.setAttribute('stroke', mColor);
        arcEl.style.display = '';
      } else {
        arcEl.style.display = 'none';
      }
    }
    if (knobEl) {
      const kp = this._pt(knobAngle);
      knobEl.setAttribute('cx', kp.x.toFixed(1));
      knobEl.setAttribute('cy', kp.y.toFixed(1));
    }
    if (txtEl) txtEl.textContent = String(temp);
  }

  /* ── Үйлдлүүд ── */
  _doPower(isOn) {
    this._write(0, isOn ? 0 : 1);
    if (isOn) { // унтраах үед pending mode цэвэрлэнэ
      clearTimeout(this._mTimer);
      this._pendingMode = null;
    }
  }

  _doMode(m) {
    if (this._num(this._config.sensors.power) !== 1) this._write(0, 1);
    this._write(1, m);
    // Товч шууд тодорно; дугуйн өнгө sensor баталгаажсаны дараа солигдоно
    this._pendingMode = m;
    clearTimeout(this._mTimer);
    this._mTimer = setTimeout(() => { this._pendingMode = null; this._render(); }, 180000);
    this._render();
  }

  _doFan(level) {
    if (this._num(this._config.sensors.power) !== 1) this._write(0, 1);
    this._write(2, level);
  }

  _onDragMove(e, rect) {
    const sx = ((e.clientX - rect.left) / rect.width)  * VW;
    const sy = ((e.clientY - rect.top)  / rect.height) * VH;
    let ang = Math.atan2(sy - CY, sx - CX) * 180 / Math.PI;
    if (ang < 0) ang += 360;

    const mKey = String(Math.round(this._num(this._config.sensors.mode) ?? 1));
    const temp = this._angleToTemp(ang, mKey);

    if (temp !== this._pending) {
      this._pending = temp;
      this._write(4, temp);
      clearTimeout(this._pTimer);
      this._pTimer = setTimeout(() => { this._pending = null; this._render(); }, 180000);
    }
    this._updateDial(temp);
  }

  /* ── Render ── */
  _render() {
    if (!this._config || !this._hass) return;
    const cfg = this._config;
    const sns = cfg.sensors;

    const power    = this._num(sns.power);
    const mode     = this._num(sns.mode);
    const setTemp  = this._pending ?? this._num(sns.set_temp);
    const ambTemp  = this._num(sns.ambient_temp);
    const fanSpeed = this._num(sns.fan_speed);

    const isOn = power === 1;

    /* ── Sensor горим → дугуйн өнгө, чиглэл ── */
    const mKey  = String(Math.round(mode ?? 1));
    const mInfo = MODES[mKey] ?? MODES['1'];
    const mColor = isOn ? mInfo.color : '#9E9E9E';

    /* ── Optimistic горим → товч харуулах ── */
    const dispKey = this._pendingMode !== null ? String(this._pendingMode) : mKey;

    /* ── Fan: 1–5 шат ── */
    const fanLvl = fanSpeed !== null
      ? Math.max(1, Math.min(5, Math.round(fanSpeed)))
      : 1;
    const fanPct = ((fanLvl - 1) / 4) * 100;
    const fanBg  = `linear-gradient(to right, ${mColor} ${fanPct}%, var(--secondary-background-color, #e8e8e8) ${fanPct}%)`;

    /* ── Arc тооцоолол (горимоор) ── */
    const bgArc  = this._arc(A0, AE);
    let arcResult = { arcPath: null, knobAngle: A0 };

    if (setTemp !== null) {
      arcResult = this._arcForTemp(setTemp, mKey);
    }
    const { arcPath, knobAngle } = arcResult;
    const kp = this._pt(knobAngle);

    const setTxt = setTemp !== null ? `${setTemp}` : '--';
    const ambTxt = ambTemp !== null ? ambTemp.toFixed(1) : '--';

    /* ── Горим товч style ── */
    const mBSt = (key, color) => {
      const active = isOn && dispKey === key;
      return `style="background:${active ? color : 'transparent'};` +
        `color:${active ? '#fff' : 'var(--secondary-text-color)'};--mdc-icon-size:22px"`;
    };
    const pBSt = `style="background:${!isOn
      ? 'var(--secondary-background-color,#f5f5f5)'
      : 'transparent'};color:${!isOn
      ? 'var(--primary-text-color)'
      : 'var(--secondary-text-color)'};--mdc-icon-size:22px"`;

    /* Fan горим: knob харагдана боловч drag биш; arc үргэлж дүүрэн */
    const showKnob = isOn;               // бүх горимд харагдана
    const arcOpacity = isOn ? 0.95 : 0.25;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="header">
          <span class="title">${cfg.name ?? 'FCU'}</span>
        </div>

        <div class="body">
          <!-- ── Arc термостат ── -->
          <svg class="dial" id="d-svg" viewBox="0 0 ${VW} ${VH}">
            <defs>
              <filter id="ksh" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-opacity="0.22"/>
              </filter>
            </defs>

            <!-- Дэвсгэр arc -->
            <path d="${bgArc}" fill="none"
              stroke="#EBEBEB" stroke-width="${W}" stroke-linecap="round"/>

            <!-- Идэвхтэй arc (горимоор чиглэл, өнгө) -->
            ${arcPath
              ? `<path id="arc-act" d="${arcPath}" fill="none"
                   stroke="${mColor}" stroke-width="${W}" stroke-linecap="round"
                   opacity="${arcOpacity}"/>`
              : `<path id="arc-act" d="${bgArc}" fill="none"
                   stroke="${mColor}" stroke-width="${W}" stroke-linecap="round"
                   opacity="0" style="display:none"/>`
            }

            <!-- Knob (fan горимд нуугдана) -->
            <circle id="arc-knob"
              cx="${kp.x.toFixed(1)}" cy="${kp.y.toFixed(1)}" r="17"
              fill="white" stroke="${mColor}" stroke-width="3.5"
              opacity="${showKnob ? 1 : 0}"
              filter="url(#ksh)"
              style="cursor:${isOn && mKey !== '2' ? 'grab' : 'default'};touch-action:none;pointer-events:${mKey === '2' ? 'none' : 'auto'}"/>

            <!-- Горим нэр (sensor-оос) -->
            <text x="150" y="108" text-anchor="middle"
              class="dial-mode" fill="${mColor}">
              ${isOn ? mInfo.label : 'Off'}
            </text>

            <!-- Тохируулга температур -->
            <text y="200" text-anchor="middle" x="150">
              <tspan id="temp-txt" class="dial-temp">${setTxt}</tspan><tspan
                class="dial-unit" dy="-22">°C</tspan>
            </text>

            <!-- Орчны температур -->
            <text x="150" y="232" text-anchor="middle" class="dial-amb">
              🌡 ${ambTxt} °C
            </text>
          </svg>

          <!-- ── Fan slider ── -->
          <div class="fan-section" style="--fan-clr:${mColor}">
            <div class="fan-lbl-row">
              <span>Сэнсний хурд</span>
              <span class="fan-speed-val" id="fan-lbl">Шат ${fanLvl}</span>
            </div>
            <input type="range" class="fan-slider" id="fan-sl"
              min="1" max="5" step="1" value="${fanLvl}"
              ${!isOn ? 'disabled' : ''}
              style="background:${fanBg}">
            <div class="fan-marks">
              <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
            </div>
          </div>

          <!-- ── Горим товчлуурууд ── -->
          <div class="mode-row">
            <button class="mode-btn" id="b-off" ${pBSt}>
              <ha-icon icon="mdi:power"></ha-icon>
            </button>
            <button class="mode-btn" id="b-fan"
              ${mBSt('2', MODES['2'].color)}>
              <ha-icon icon="mdi:fan"></ha-icon>
            </button>
            <button class="mode-btn" id="b-cool"
              ${mBSt('0', MODES['0'].color)}>
              <ha-icon icon="mdi:snowflake"></ha-icon>
            </button>
            <button class="mode-btn" id="b-heat"
              ${mBSt('1', MODES['1'].color)}>
              <ha-icon icon="mdi:fire"></ha-icon>
            </button>
          </div>
        </div>
      </ha-card>`;

    const sr = this.shadowRoot;

    /* ── Горим товч ── */
    sr.getElementById('b-off') ?.addEventListener('click', () => this._doPower(isOn));
    sr.getElementById('b-fan') ?.addEventListener('click', () => this._doMode(2));
    sr.getElementById('b-cool')?.addEventListener('click', () => this._doMode(0));
    sr.getElementById('b-heat')?.addEventListener('click', () => this._doMode(1));

    /* ── Fan slider ── */
    const fanSl = sr.getElementById('fan-sl');
    if (fanSl) {
      fanSl.addEventListener('input', e => {
        const v   = parseInt(e.target.value);
        const pct = ((v - 1) / 4) * 100;
        e.target.style.background =
          `linear-gradient(to right, ${mColor} ${pct}%, var(--secondary-background-color, #e8e8e8) ${pct}%)`;
        const lbl = sr.getElementById('fan-lbl');
        if (lbl) lbl.textContent = `Шат ${v}`;
      });
      fanSl.addEventListener('change', e => {
        this._doFan(parseInt(e.target.value));
      });
    }

    /* ── Arc drag — зөвхөн исон үед, fan горим биш үед ── */
    const svg = sr.getElementById('d-svg');
    if (svg && isOn && mKey !== '2') {
      svg.addEventListener('pointerdown', e => {
        const rect = svg.getBoundingClientRect();
        const sx = ((e.clientX - rect.left) / rect.width)  * VW;
        const sy = ((e.clientY - rect.top)  / rect.height) * VH;
        const dx = sx - CX, dy = sy - CY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(dist - R) > 36) return;   // arc ring-ийн ойролцоо дарсан үед
        e.preventDefault();
        this._dragging = true;
        svg.setPointerCapture(e.pointerId);
        this._onDragMove(e, rect);
      });

      svg.addEventListener('pointermove', e => {
        if (!this._dragging) return;
        e.preventDefault();
        this._onDragMove(e, svg.getBoundingClientRect());
      });

      svg.addEventListener('pointerup',     () => { this._dragging = false; });
      svg.addEventListener('pointercancel', () => { this._dragging = false; });
    }
  }

  getCardSize() { return 5; }

  static getStubConfig() {
    return {
      name: 'FCU 1',
      hub: 'modbus_gateway',
      slave: 2,
      min_temp: 16,
      max_temp: 30,
      sensors: {
        power:        'sensor.fcu_1_power_state',
        mode:         'sensor.fcu_1_mode',
        set_temp:     'sensor.fcu_1_set_temperature',
        ambient_temp: 'sensor.fcu_1_ambient_temperature',
        fan_speed:    'sensor.fcu_1_fan_speed',
      },
    };
  }
}

customElements.define('fcu-climate-card', FcuClimateCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'fcu-climate-card',
  name: 'FCU Climate Card',
  description: 'RS485 Modbus FCU термостат — heat/cool/fan arc чиглэл · drag · fan slider',
  preview: true,
});
console.info(
  '%c FCU-CLIMATE-CARD %c v1.3.1 ',
  'color:#fff;background:#1E88E5;font-weight:bold;padding:2px 4px;border-radius:4px 0 0 4px',
  'color:#1E88E5;background:#E3F2FD;font-weight:bold;padding:2px 4px;border-radius:0 4px 4px 0'
);

// v1.3.1 patch notes:
// - Cool arc: _arc(A0, knobAngle) — зүүнаас, knob баруун=min, зүүн=max
// - Fan mode: knob харагдана (setTemp байрлалд), drag болохгүй, temp солихгүй
