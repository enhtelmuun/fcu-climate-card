# FCU Climate Card

RS485 Modbus **Fan Coil Unit (FCU)** термостат custom card — HA thermostat карттай адил харагдах, **sensor суурилсан** хяналт.

> Climate entity ашиглахгүй. Бүх утгыг Modbus sensor-оос уншиж, `modbus.write_register` сервисээр RS485 бичнэ.

---

## ✨ Онцлог

- **Термостат дугуй** — HA-н thermostat карттай адил SVG arc дизайн
- **Sensor суурилсан** — climate entity-н `scale` асуудлаас чөлөөлөгдсөн
- **RS485 write** — `modbus.write_register` сервисээр шууд бичнэ
- **Оновчтой update** — +/− дарахад sensor шинэчлэгдэхийг хүлээлгүй шууд харуулна
- **Горим өнгө:** Cool=цэнхэр · Heat=улаан · Fan=cyan · Off=саарал
- **Алдааны мэдэгдэл** — `fault_entity` холбосон бол Register 24 дээр тулгуурлан харуулна

---

## 📦 Суулгах

### HACS ашиглан
1. **HACS → Frontend → ⋮ → Custom repositories**
2. URL: `https://github.com/enhtelmuun/fcu-climate-card`
3. Category: `Dashboard` → **ADD**
4. **FCU Climate Card → Download**
5. HA restart

### Гараар
```
fcu-climate-card.js  →  config/www/fcu-climate-card.js
```
`configuration.yaml`:
```yaml
lovelace:
  resources:
    - url: /local/fcu-climate-card.js
      type: module
```

---

## ⚙️ Карт тохиргоо

```yaml
type: custom:fcu-climate-card
name: FCU 1              # харуулах нэр
hub: modbus_gateway      # configuration.yaml дахь modbus hub нэр
slave: 2                 # RS485 slave ID
min_temp: 16             # хамгийн бага тохируулга °C (default: 16)
max_temp: 30             # хамгийн их тохируулга °C (default: 30)
sensors:
  power:        sensor.fcu_1_power_state         # addr 0 — заавал
  mode:         sensor.fcu_1_mode                # addr 1 — заавал
  set_temp:     sensor.fcu_1_set_temperature     # addr 4 — заавал
  ambient_temp: sensor.fcu_1_ambient_temperature # addr 20 — заавал биш
  fan_speed:    sensor.fcu_1_fan_speed           # addr 2 — заавал биш
  fault:        sensor.fcu_1_fault_status        # addr 24 — заавал биш
```

| Талбар | Заавал | Тайлбар |
|--------|--------|---------|
| `hub` | ✅ | `configuration.yaml` дахь modbus hub-ийн нэр |
| `slave` | ✅ | RS485 slave ID |
| `sensors.power` | ✅ | Register 0 sensor |
| `sensors.mode` | ✅ | Register 1 sensor |
| `sensors.set_temp` | ✅ | Register 4 sensor |
| `sensors.ambient_temp` | ❌ | Register 20, `scale: 0.1` байх ёстой |
| `sensors.fan_speed` | ❌ | Register 2 sensor |
| `sensors.fault` | ❌ | Register 24 — алдааны chip харуулна |
| `min_temp` | ❌ | Хамгийн бага тохируулга (default: 16) |
| `max_temp` | ❌ | Хамгийн их тохируулга (default: 30) |

---

## 🔧 configuration.yaml — Modbus Sensor тохиргоо

```yaml
modbus:
  - name: modbus_gateway
    type: tcp
    host: 10.1.1.3
    port: 502
    timeout: 5
    delay: 2
    message_wait_milliseconds: 200

    sensors:
      # ── FCU 1 (slave: 2) ──────────────────────────────
      - name: FCU 1 Power State
        slave: 2
        address: 0
        input_type: holding
        data_type: int16

      - name: FCU 1 Mode
        slave: 2
        address: 1
        input_type: holding
        data_type: int16

      - name: FCU 1 Fan Speed
        slave: 2
        address: 2
        input_type: holding
        data_type: int16

      - name: FCU 1 Set Temperature
        slave: 2
        address: 4
        input_type: holding
        data_type: int16
        unit_of_measurement: "°C"

      - name: FCU 1 Ambient Temperature
        slave: 2
        address: 20
        input_type: holding
        data_type: int16
        scale: 0.1             # ← 238 raw = 23.8°C
        precision: 1
        unit_of_measurement: "°C"
        device_class: temperature
        state_class: measurement

      - name: FCU 1 Fault Status
        slave: 2
        address: 24
        input_type: holding
        data_type: int16

      # ── FCU 2 (slave: 3), FCU 3 (slave: 4) ... адилаар үргэлжлүүлнэ
```

---

## 📋 Register зураглал (RS485 протокол)

| Register | Уншина | Бичнэ | Утга |
|----------|--------|-------|------|
| 0 | ✅ | ✅ | Power: `0`=off · `1`=on |
| 1 | ✅ | ✅ | Mode: `0`=Cool · `1`=Heat · `2`=Fan |
| 2 | ✅ | ✅ | Fan speed: `1`–`5` |
| 3 | ✅ | ✅ | Fan type: `0`=Manual · `1`=Auto |
| 4 | ✅ | ✅ | Set temperature (°C, бүхэл тоо) |
| 20 | ✅ | — | Ambient temperature (÷10 → °C) |
| 21 | ✅ | — | Pipe temperature |
| 22 | ✅ | — | Real-time RPM |
| 24 | ✅ | — | Fault status (Bit0–Bit6) |

### Register 24 — Алдааны бит

| Бит | Тайлбар | Төрөл |
|-----|---------|-------|
| Bit 0 | Орчны температур сенсорын алдаа | 🔴 |
| Bit 1 | Хоолойн температур сенсорын алдаа | 🔴 |
| Bit 2 | Хавхлагын гаралт | 🟡 |
| Bit 3 | Пассив цэгийн хаалт | 🟡 |
| Bit 4 | Хөлдөлтөөс хамгаалалт идэвхтэй | 🟡 |
| Bit 5 | Хүйтэн салхины хамгаалалт | 🟡 |
| Bit 6 | Сэнсний (мотор) алдаа | 🔴 |

---

## 🖱️ Товчлуурын тайлбар

| Товч | Үйлдэл | RS485 write |
|------|--------|-------------|
| ⏻ | Power toggle | addr 0 → 0 эсвэл 1 |
| 🌀 | Fan горим | addr 1 → 2 |
| ❄ | Cool горим | addr 1 → 0 |
| 🔥 | Heat горим | addr 1 → 1 |
| − | Температур −1°C | addr 4 → setTemp−1 |
| + | Температур +1°C | addr 4 → setTemp+1 |

---

## 📜 Хувилбарын түүх

| Хувилбар | Өөрчлөлт |
|----------|----------|
| v1.0.0 | Анхны хувилбар — sensor суурилсан, write_register дэмжлэгтэй |
