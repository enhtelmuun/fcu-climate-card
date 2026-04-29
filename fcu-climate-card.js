/**
 * FCU Climate Card  v1.2.0
 * ═══════════════════════════════════════════════════════════════
 * Шинэчлэлт v1.2.0:
 *   - Arc слайдер (touch/mouse drag) — set temp тохируулна
 *   - 60 секундын дараа sensor утга руу буцах
 *   - Fan speed → horizontal range slider (1–5 шат)
 *   - Алдааны chip болон +/− товч хасагдсан
 *   - Arc томорсон (r=120, W=28)
 *   - Температурын тоо голлосон
 * ═══════════════════════════════════════════════════════════════
 *
 * Dashboard YAML тохиргоо:
 *   type: custom:fcu-climate-card
 *   name: FCU 1
 *   hub: modbus_gateway
 *   slave: 2
 *   min_temp: 16
 *   max_temp: 30
 *   sensors:
 *     power:        sensor.fcu_1_power_state
 *     mode:         sensor.fcu_1_mode
 *     set_temp:     sensor.fcu_1_set_temperature
 *     ambient_temp: sensor.fcu_1_ambient_temperature
 *     fan_speed:    sensor.fcu_1_fan_speed
 */

/* ── Arc тогтмол ── */
const CX = 150, CY = 148, R = 120, W = 28;
const A0 = 135, SPAN = 270;
const VW = 300, VH = 290;

const MODES = {
  '0': { label: 'Cool', color: '#1E88E5' },
  '1': { label: 'Heat', color: '#E53935' },
  '2': { label: 'Fan',  color: '#00ACC1' },
};

const STYLES = `
:host { display: block; }
ha-card { overflow: hidden; font-family: var(--primary-font-family, sans-serif); }

/* ── Header ── */
.header { padding: 16px 16px 0; }
.title { font-size: 16px; font-weight: 500; color: var(--primary-text-color); }

/* ── Body ── */
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
  transition: background 0.1s;
}
.fan-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--fan-clr, #1E88E5);
  box-shadow: 0 1px 6px rgba(0,0,0,0.28);
  cursor: grab;
  transition: transform 0.1s;
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
    this._config   = null;
    this._hass     = null;
    this._pending  = null;   // drag-аар оновчтой set_temp
    this._pTimer   = null;
    this._dragging = false;
  }

  /* ── Config ── */
  setConfig(cfg) {
    if (!cfg.hub)     throw new Error("'hub' шаардлагатай (modbus hub нэр)");
    if (!cfg.slave)   throw new Error("'slave' шаардлагатай (RS485 slave ID)");
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

  _angleToTemp(deg) {
    const cfg = this._config;
    let ratio;
    if      (deg >= 135) ratio = (deg - 135) / SPAN;
    else if (deg <= 45)  ratio = (deg + 225) / SPAN;
    else                 ratio = deg < 90 ? 1 : 0;
    ratio = Math.max(0, Math.min(1, ratio));
    return Math.round(cfg.min_temp + ratio * (cfg.max_temp - cfg.min_temp));
  }

  /* ── Drag үед зөвхөн arc/knob/text шинэчлэх (full re-render хийхгүй) ── */
  _updateDial(temp) {
    const sr  = this.shadowRoot;
    const cfg = this._config;
    const isOn   = this._num(cfg.sensors.power) === 1;
    const mode   = this._num(cfg.sensors.mode);
    const mColor = isOn
      ? (MODES[String(Math.round(mode ?? 0))] ?? MODES['0']).color
      : '#9E9E9E';

    const ratio = Math.max(0, Math.min(1,
      (temp - cfg.min_temp) / (cfg.max_temp - cfg.min_temp)));
    const endA = A0 + ratio * SPAN;

    const arcEl  = sr.getElementById('arc-act');
    const knobEl = sr.getElementById('arc-knob');
    const txtEl  = sr.getElementById('temp-txt');

    if (arcEl) {
      if (ratio > 0.005) {
        arcEl.setAttribute('d', this._arc(A0, endA));
        arcEl.setAttribute('stroke', mColor);
        arcEl.style.display = '';
      } else {
        arcEl.style.display = 'none';
      }
    }
    if (knobEl) {
      const kp = this._pt(endA);
      knobEl.setAttribute('cx', kp.x.toFixed(1));
      knobEl.setAttribute('cy', kp.y.toFixed(1));
    }
    if (txtEl) txtEl.textContent = String(temp);
  }

  /* ── Үйлдлүүд ── */
  _doPower(isOn) { this._write(0, isOn ? 0 : 1); }

  _doMode(m) {
    if (this._num(this._config.sensors.power) !== 1) this._write(0, 1);
    this._write(1, m);
  }

  _doFan(level) {
    if (this._num(this._config.sensors.power) !== 1) this._write(0, 1);
    this._write(2, level);
  }

  _onDragMove(e, rect) {
    const sx  = ((e.clientX - rect.left) / rect.width)  * VW;
    const sy  = ((e.clientY - rect.top)  / rect.height) * VH;
    let ang = Math.atan2(sy - CY, sx - CX) * 180 / Math.PI;
    if (ang < 0) ang += 360;

    const temp = this._angleToTemp(ang);
    if (temp !== this._pending) {
      this._pending = temp;
      this._write(4, temp);
      clearTimeout(this._pTimer);
      this._pTimer = setTimeout(() => {
        this._pending = null;
        this._render();
      }, 60000);
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

    const isOn  = power === 1;
    const mKey  = String(Math.round(mode ?? 0));
    const mInfo = MODES[mKey] ?? MODES['0'];
    const mColor = isOn ? mInfo.color : '#9E9E9E';

    /* Fan: 1–5 шат */
    const fanLvl = fanSpeed !== null
      ? Math.max(1, Math.min(5, Math.round(fanSpeed)))
      : 1;
    const fanPct = ((fanLvl - 1) / 4) * 100;
    const fanBg  = `linear-gradient(to right, ${mColor} ${fanPct}%, var(--secondary-background-color, #e8e8e8) ${fanPct}%)`;

    /* Arc */
    const bgArc = this._arc(A0, A0 + SPAN);
    let actArc = null;
    let kp = this._pt(A0);

    if (setTemp !== null) {
      const ratio = Math.max(0, Math.min(1,
        (setTemp - cfg.min_temp) / (cfg.max_temp - cfg.min_temp)));
      const endA = A0 + ratio * SPAN;
      if (ratio > 0.005) actArc = this._arc(A0, endA);
      kp = this._pt(endA);
    }

    const setTxt = setTemp !== null ? `${setTemp}` : '--';
    const ambTxt = ambTemp !== null ? ambTemp.toFixed(1) : '--';

    /* Mode button inline style */
    const mBSt = (active, color) =>
      `style="background:${active ? color : 'transparent'};` +
      `color:${active ? '#fff' : 'var(--secondary-text-color)'};--mdc-icon-size:22px"`;
    const pBSt =
      `style="background:${!isOn ? 'var(--secondary-background-color,#f5f5f5)' : 'transparent'};` +
      `color:${!isOn ? 'var(--primary-text-color)' : 'var(--secondary-text-color)'};--mdc-icon-size:22px"`;

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

            <!-- Background arc -->
            <path d="${bgArc}" fill="none"
              stroke="#EBEBEB" stroke-width="${W}" stroke-linecap="round"/>

            <!-- Active arc -->
            ${actArc
              ? `<path id="arc-act" d="${actArc}" fill="none"
                   stroke="${mColor}" stroke-width="${W}" stroke-linecap="round"
                   opacity="${isOn ? 0.95 : 0.3}"/>`
              : `<path id="arc-act" d="${bgArc}" fill="none"
                   stroke="${mColor}" stroke-width="${W}" stroke-linecap="round"
                   opacity="0" style="display:none"/>`
            }

            <!-- Knob -->
            <circle id="arc-knob"
              cx="${kp.x.toFixed(1)}" cy="${kp.y.toFixed(1)}" r="17"
              fill="white" stroke="${mColor}" stroke-width="3.5"
              opacity="${isOn ? 1 : 0.4}"
              filter="url(#ksh)"
              style="cursor:grab;touch-action:none"/>

            <!-- Горим нэр -->
            <text x="150" y="108" text-anchor="middle"
              class="dial-mode" fill="${mColor}">
              ${isOn ? mInfo.label : 'Off'}
            </text>

            <!-- Тохируулга температур (голлосон) -->
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
            <button class="mode-btn" id="b-off"  ${pBSt}>
              <ha-icon icon="mdi:power"></ha-icon>
            </button>
            <button class="mode-btn" id="b-fan"
              ${mBSt(isOn && mKey === '2', MODES['2'].color)}>
              <ha-icon icon="mdi:fan"></ha-icon>
            </button>
            <button class="mode-btn" id="b-cool"
              ${mBSt(isOn && mKey === '0', MODES['0'].color)}>
              <ha-icon icon="mdi:snowflake"></ha-icon>
            </button>
            <button class="mode-btn" id="b-heat"
              ${mBSt(isOn && mKey === '1', MODES['1'].color)}>
              <ha-icon icon="mdi:fire"></ha-icon>
            </button>
          </div>
        </div>
      </ha-card>`;

    const sr = this.shadowRoot;

    /* ── Mode товч event ── */
    sr.getElementById('b-off') ?.addEventListener('click', () => this._doPower(isOn));
    sr.getElementById('b-fan') ?.addEventListener('click', () => this._doMode(2));
    sr.getElementById('b-cool')?.addEventListener('click', () => this._doMode(0));
    sr.getElementById('b-heat')?.addEventListener('click', () => this._doMode(1));

    /* ── Fan slider event ── */
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

    /* ── Arc drag event ── */
    const svg = sr.getElementById('d-svg');
    if (svg) {
      svg.addEventListener('pointerdown', e => {
        const rect = svg.getBoundingClientRect();
        const sx = ((e.clientX - rect.left) / rect.width)  * VW;
        const sy = ((e.clientY - rect.top)  / rect.height) * VH;
        const dx = sx - CX, dy = sy - CY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        /* Arc ring ойролцоо (±36px) дарсан үед л идэвхжинэ */
        if (Math.abs(dist - R) > 36) return;
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
  description: 'RS485 Modbus FCU термостат — arc drag · fan slider · mode удирдах',
  preview: true,
});
console.info(
  '%c FCU-CLIMATE-CARD %c v1.2.0 ',
  'color:#fff;background:#1E88E5;font-weight:bold;padding:2px 4px;border-radius:4px 0 0 4px',
  'color:#1E88E5;background:#E3F2FD;font-weight:bold;padding:2px 4px;border-radius:0 4px 4px 0'
);
