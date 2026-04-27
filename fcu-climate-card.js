/**
 * FCU Climate Card  v1.1.0
 * ═══════════════════════════════════════════════════════════════
 * Modbus sensor-уудыг уншиж, modbus.write_register сервисээр
 * RS485 бичих боломжтой термостат custom card.
 * Climate entity ашиглахгүй — бүх утга sensor-оос ирнэ.
 *
 * Dashboard YAML тохиргоо:
 *   type: custom:fcu-climate-card
 *   name: FCU 1
 *   hub: modbus_gateway        # configuration.yaml дахь modbus hub нэр
 *   slave: 2                   # RS485 slave ID
 *   min_temp: 16               # хамгийн бага тохируулга (°C)
 *   max_temp: 30               # хамгийн их тохируулга (°C)
 *   sensors:
 *     power:        sensor.fcu_1_power_state
 *     mode:         sensor.fcu_1_mode
 *     set_temp:     sensor.fcu_1_set_temperature
 *     ambient_temp: sensor.fcu_1_ambient_temperature   # scale: 0.1 байх ёстой
 *     fan_speed:    sensor.fcu_1_fan_speed
 *     fault:        sensor.fcu_1_fault_status          # заавал биш
 *
 * Удирдах боломжтой зүйлс:
 *   − / +        → addr 4  Set temperature
 *   ● ● ○ ○     → addr 2  Fan speed (1·3·4·5 шат)
 *   ⏻ 🌀 ❄ 🔥  → addr 0,1 Power / Mode
 *
 * Register зураглал (RS485 PDF протокол):
 *   addr 0  → Power (0=off, 1=on)          — уншина/бичнэ
 *   addr 1  → Mode  (0=cool,1=heat,2=fan)  — уншина/бичнэ
 *   addr 2  → Fan speed (1–5 шат)          — уншина/бичнэ
 *   addr 4  → Set temperature (°C)         — уншина/бичнэ
 *   addr 20 → Ambient temperature (×0.1°C) — зөвхөн уншина
 *   addr 24 → Fault status (Bit0–Bit6)     — зөвхөн уншина
 * ═══════════════════════════════════════════════════════════════
 */

const MODES = {
  '0': { label: 'Cool', icon: 'mdi:snowflake', color: '#1E88E5' },
  '1': { label: 'Heat', icon: 'mdi:fire',      color: '#E53935' },
  '2': { label: 'Fan',  icon: 'mdi:fan',        color: '#00ACC1' },
};

/* Fan speed: register утга → харуулах индекс (0–3) */
const FAN_VALS   = [1, 3, 4, 5];
const FAN_LABELS = ['Шат 1', 'Шат 3', 'Шат 4', 'Шат 5'];

const STYLES = `
:host { display: block; }
ha-card { overflow: hidden; font-family: var(--primary-font-family, sans-serif); }

/* ── Header ── */
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 0;
}
.title { font-size: 16px; font-weight: 500; color: var(--primary-text-color); }
.fault-chip {
  font-size: 11px; font-weight: 500;
  background: #FCEBEB; color: #A32D2D;
  padding: 2px 9px; border-radius: 99px;
}

/* ── Body ── */
.body {
  display: flex; flex-direction: column; align-items: center;
  padding: 0 12px 0;
}

/* ── SVG термостат ── */
.dial { width: 100%; max-width: 280px; overflow: visible; }
.dial-mode { font-size: 18px; font-weight: 500; }
.dial-temp { font-size: 58px; font-weight: 300; fill: var(--primary-text-color); }
.dial-unit { font-size: 24px; font-weight: 300; fill: var(--primary-text-color); }
.dial-amb  { font-size: 15px; fill: var(--secondary-text-color); }

/* ── Температур товч ── */
.controls { display: flex; gap: 32px; margin: -6px 0 8px; }
.ctrl-btn {
  width: 46px; height: 46px; border-radius: 50%;
  border: 1.5px solid var(--divider-color, #e0e0e0);
  background: transparent; font-size: 28px; line-height: 1;
  cursor: pointer; color: var(--primary-text-color);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.ctrl-btn:active { background: var(--secondary-background-color, #f5f5f5); }
.ctrl-btn:disabled { opacity: 0.3; cursor: default; }

/* ── Fan speed ── */
.fan-row {
  display: flex; align-items: center; gap: 0; margin-bottom: 12px;
  background: var(--secondary-background-color, #f5f5f5);
  border-radius: 99px; padding: 4px;
}
.fan-btn {
  display: flex; align-items: center; justify-content: center;
  gap: 5px; padding: 6px 14px; border: none; border-radius: 99px;
  background: transparent; cursor: pointer;
  font-size: 12px; font-weight: 500;
  color: var(--secondary-text-color);
  transition: background 0.15s, color 0.15s;
  -webkit-tap-highlight-color: transparent;
  white-space: nowrap;
}
.fan-btn.f-active {
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}
.fan-dot-sm {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--divider-color, #ccc); display: inline-block;
  transition: background 0.15s;
}
.fan-dot-sm.filled { background: currentColor; }

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
    this._config  = null;
    this._hass    = null;
    this._pending = null;   // оновчтой set_temp
    this._pTimer  = null;
  }

  /* ── Config ──────────────────────────────────────────────── */
  setConfig(cfg) {
    if (!cfg.hub)     throw new Error("'hub' шаардлагатай (modbus hub нэр)");
    if (!cfg.slave)   throw new Error("'slave' шаардлагатай (RS485 slave ID)");
    if (!cfg.sensors) throw new Error("'sensors' шаардлагатай");
    this._config = { min_temp: 16, max_temp: 30, ...cfg };
    this._render();
  }

  set hass(h) { this._hass = h; this._render(); }

  /* ── Туслах ──────────────────────────────────────────────── */
  _num(id) {
    if (!id || !this._hass) return null;
    const v = parseFloat(this._hass.states[id]?.state);
    return isNaN(v) ? null : v;
  }

  /* modbus.write_register дуудах */
  _write(address, value) {
    this._hass.callService('modbus', 'write_register', {
      hub:   this._config.hub,
      slave: this._config.slave,
      address,
      value: Math.round(value),
    });
  }

  /* SVG arc тооцоолол */
  _pt(cx, cy, r, deg) {
    const a = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  _arc(cx, cy, r, a1, a2) {
    const s = this._pt(cx, cy, r, a1);
    const e = this._pt(cx, cy, r, a2);
    return `M${s.x.toFixed(1)} ${s.y.toFixed(1)} A${r} ${r} 0 ${a2-a1>180?1:0} 1 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
  }

  /* ── Үйлдлүүд ────────────────────────────────────────────── */
  _doPower(isOn) { this._write(0, isOn ? 0 : 1); }

  _doMode(m) {
    if (this._num(this._config.sensors.power) !== 1) this._write(0, 1);
    this._write(1, m);
  }

  _doFan(speed) {
    if (this._num(this._config.sensors.power) !== 1) this._write(0, 1);
    this._write(2, speed);
  }

  _doTemp(delta) {
    const cfg  = this._config;
    const cur  = this._pending ?? this._num(cfg.sensors.set_temp) ?? cfg.min_temp;
    const next = Math.max(cfg.min_temp, Math.min(cfg.max_temp, cur + delta));
    this._pending = next;
    this._write(4, next);
    clearTimeout(this._pTimer);
    this._pTimer = setTimeout(() => { this._pending = null; this._render(); }, 4000);
    this._render();
  }

  /* ── Render ──────────────────────────────────────────────── */
  _render() {
    if (!this._config || !this._hass) return;

    const cfg = this._config;
    const sns = cfg.sensors;

    const power    = this._num(sns.power);
    const mode     = this._num(sns.mode);
    const setTemp  = this._pending ?? this._num(sns.set_temp);
    const ambTemp  = this._num(sns.ambient_temp);
    const fanSpeed = this._num(sns.fan_speed);
    const fault    = sns.fault ? this._num(sns.fault) : null;

    const isOn   = power === 1;
    const mKey   = String(Math.round(mode ?? 0));
    const mInfo  = MODES[mKey] ?? MODES['0'];
    const mColor = isOn ? mInfo.color : '#9E9E9E';
    const hasErr = fault !== null && fault > 0;

    /* Fan speed индекс */
    const fanRaw = fanSpeed !== null ? Math.round(fanSpeed) : null;
    const fanIdx = fanRaw !== null ? FAN_VALS.indexOf(fanRaw) : -1;

    /* ── SVG ── */
    const cx = 150, cy = 158, r = 112, W = 26;
    const A0 = 135, SPAN = 270;
    const bgArc = this._arc(cx, cy, r, A0, A0 + SPAN);

    let actArc = '', kx = cx, ky = cy + r;
    if (isOn && setTemp !== null) {
      const ratio = Math.max(0, Math.min(1, (setTemp - cfg.min_temp) / (cfg.max_temp - cfg.min_temp)));
      const endA  = A0 + ratio * SPAN;
      if (ratio > 0.005) actArc = this._arc(cx, cy, r, A0, endA);
      const kp = this._pt(cx, cy, r, endA);
      kx = kp.x; ky = kp.y;
    }

    const setTxt = setTemp !== null ? `${setTemp}` : '--';
    const ambTxt = ambTemp !== null ? `${ambTemp.toFixed(1)}` : '--';

    /* ── Fan speed товчлуурууд ── */
    const fanBtns = FAN_VALS.map((v, i) => {
      const active = i === fanIdx;
      /* Дотоод цэгүүд: i+1 тооны цэг харуулна */
      const dots = FAN_VALS.map((_, di) =>
        `<span class="fan-dot-sm${di <= i ? ' filled' : ''}"
          style="${di <= i && active ? `background:${mColor}` : ''}"></span>`
      ).join('');
      return `
        <button class="fan-btn${active ? ' f-active' : ''}"
          data-spd="${v}"
          style="${active ? `color:${mColor}` : ''}">
          ${dots}
        </button>`;
    }).join('');

    /* ── Горим товчлуурын inline style ── */
    const mBtnSt = (active, color) => active
      ? `background:${color};color:#fff;--mdc-icon-size:22px`
      : 'background:transparent;--mdc-icon-size:22px';
    const pBtnSt = !isOn
      ? `background:var(--secondary-background-color,#f5f5f5);color:var(--primary-text-color);--mdc-icon-size:22px`
      : `background:transparent;--mdc-icon-size:22px`;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="header">
          <span class="title">${cfg.name ?? 'FCU'}</span>
          ${hasErr ? `<span class="fault-chip">⚠ Алдаа</span>` : ''}
        </div>

        <div class="body">
          <!-- Термостат дугуй -->
          <svg class="dial" viewBox="0 0 300 316">
            <defs>
              <filter id="kshadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-opacity="0.22"/>
              </filter>
            </defs>
            <path d="${bgArc}" fill="none" stroke="#EBEBEB" stroke-width="${W}" stroke-linecap="round"/>
            ${actArc ? `<path d="${actArc}" fill="none" stroke="${mColor}" stroke-width="${W}" stroke-linecap="round" opacity="0.95"/>` : ''}
            ${isOn ? `<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="15"
              fill="white" stroke="${mColor}" stroke-width="3.5" filter="url(#kshadow)"/>` : ''}
            <text x="150" y="106" text-anchor="middle" class="dial-mode" fill="${mColor}">
              ${isOn ? mInfo.label : 'Off'}
            </text>
            <text x="140" y="182" text-anchor="end" class="dial-temp">${setTxt}</text>
            <text x="145" y="163" text-anchor="start" class="dial-unit">°C</text>
            <text x="150" y="214" text-anchor="middle" class="dial-amb">🌡 ${ambTxt} °C</text>
          </svg>

          <!-- Температур +/- -->
          <div class="controls">
            <button class="ctrl-btn" id="b-minus" ${!isOn ? 'disabled' : ''}>−</button>
            <button class="ctrl-btn" id="b-plus"  ${!isOn ? 'disabled' : ''}>+</button>
          </div>

          <!-- Fan speed -->
          <div class="fan-row">${fanBtns}</div>

          <!-- Горим товчлуурууд -->
          <div class="mode-row">
            <button class="mode-btn" id="b-off"  style="${pBtnSt}">
              <ha-icon icon="mdi:power"></ha-icon>
            </button>
            <button class="mode-btn" id="b-fan"  style="${mBtnSt(isOn && mKey==='2', MODES['2'].color)}">
              <ha-icon icon="mdi:fan"></ha-icon>
            </button>
            <button class="mode-btn" id="b-cool" style="${mBtnSt(isOn && mKey==='0', MODES['0'].color)}">
              <ha-icon icon="mdi:snowflake"></ha-icon>
            </button>
            <button class="mode-btn" id="b-heat" style="${mBtnSt(isOn && mKey==='1', MODES['1'].color)}">
              <ha-icon icon="mdi:fire"></ha-icon>
            </button>
          </div>
        </div>
      </ha-card>`;

    /* ── Event listeners ── */
    this.shadowRoot.getElementById('b-minus')?.addEventListener('click', () => this._doTemp(-1));
    this.shadowRoot.getElementById('b-plus') ?.addEventListener('click', () => this._doTemp(+1));
    this.shadowRoot.getElementById('b-off')  ?.addEventListener('click', () => this._doPower(isOn));
    this.shadowRoot.getElementById('b-fan')  ?.addEventListener('click', () => this._doMode(2));
    this.shadowRoot.getElementById('b-cool') ?.addEventListener('click', () => this._doMode(0));
    this.shadowRoot.getElementById('b-heat') ?.addEventListener('click', () => this._doMode(1));

    this.shadowRoot.querySelectorAll('.fan-btn').forEach(btn => {
      btn.addEventListener('click', () => this._doFan(parseInt(btn.dataset.spd)));
    });
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
        fault:        'sensor.fcu_1_fault_status',
      },
    };
  }
}

customElements.define('fcu-climate-card', FcuClimateCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'fcu-climate-card',
  name: 'FCU Climate Card',
  description: 'RS485 Modbus FCU термостат — set temp · fan speed · mode удирдах',
  preview: true,
});
console.info(
  '%c FCU-CLIMATE-CARD %c v1.1.0 ',
  'color:#fff;background:#1E88E5;font-weight:bold;padding:2px 4px;border-radius:4px 0 0 4px',
  'color:#1E88E5;background:#E3F2FD;font-weight:bold;padding:2px 4px;border-radius:0 4px 4px 0'
);
