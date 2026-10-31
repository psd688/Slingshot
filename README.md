# 🎯 Interactive Slingshot & LED Paintball Wall

A real-time, motion-sensor interactive slingshot exhibition game. The user takes a selfie, types a custom tag, aims the physical slingshot at a big LED wall (connected via HDMI), and releases the rubber band. The phone's accelerometer detects the physical snap/recoil shockwave and triggers a paintball splash on the LED screen featuring their photo and message!

---

## 🏗️ System Architecture

```
 ┌──────────────────────────────────────┐          Local Wi-Fi / Hotspot         ┌──────────────────────────────────────┐
 │       📱 Phone in Slingshot          │ ◄────────────────────────────────────► │      💻 Laptop / Mini-PC (HDMI)      │
 │  https://<local-ip>:3443/phone.html  │        Ultra-low latency (<15ms)       │     http://localhost:3000/tv.html    │
 │                                      │                                        │                                      │
 │  1. Selfie Camera Capture            │         WebSocket Payloads             │  1. Industrial Concrete Wall         │
 │  2. Custom Message & Paint Color     │  ────────────────────────────────────► │  2. Real-time Laser Aim Reticle      │
 │  3. Gyroscope Aiming (Pitch/Yaw)     │          • Aiming coordinates          │  3. 3D Projectile Arc + Audio        │
 │  4. Accelerometer Shockwave Trigger  │          • Photo base64 + Text Tag     │  4. Paint Splat + Photo Reveal       │
 └──────────────────────────────────────┘                                        └──────────────────┬───────────────────┘
                                                                                                    │ HDMI Cable
                                                                                                    ▼
                                                                                 ┌──────────────────────────────────────┐
                                                                                 │      📺 Big LED Screen Display       │
                                                                                 └──────────────────────────────────────┘
```

---

## 🚀 Quick Start Guide

### 1. Start the Server
On the laptop connected to the HDMI screen, run:
```bash
npm start
```
*(or `node server.js`)*

The server automatically detects your local Wi-Fi IP and starts both:
* **HTTP:** `http://localhost:3000` (for the big screen & operator dashboard)
* **HTTPS:** `https://<your-local-ip>:3443` (for phone camera & motion sensor permissions)

---

### 2. Set Up the Big LED Screen (HDMI)
1. Plug your HDMI cable from the laptop into the LED screen / TV.
2. In your browser, open:
   ```
   http://localhost:3000/tv.html
   ```
3. Click the fullscreen button ⛶ (or press **F11**).
4. Notice the QR code in the bottom corner — players or staff can scan this to connect!

---

### 3. Connect the Phone Controller
1. Connect the phone to the **same Wi-Fi network** or your laptop's Mobile Hotspot.
2. Scan the QR code displayed on the screen (or open the HTTPS link on the phone).
   *(Accept the self-signed certificate warning once if prompted)*.
3. Slot the phone into the wooden slingshot casing.

---

## ⚡ How the Motion Sensor Trigger Works

When the user pulls the rubber band back and releases it:
1. The elastic band snaps forward against the wooden frame or stopper.
2. This creates an immediate **physical shockwave jerk** ($\Delta G = |\text{acc}_t - \text{acc}_{t-1}|$).
3. The phone's `devicemotion` sensor detects this high-G spike (>3.0G - 6.0G), while smooth aiming movements (<1.2G) are ignored.
4. The phone instantly vibrates, plays a twang audio effect, and transmits the launch payload to the TV.

### Sensitivity Calibration (On Phone Screen):
* **Medium (Default - 4.2 G):** Ideal for standard rubber bands.
* **Low (Hard - 6.5 G):** For heavy elastic bands with strong recoil.
* **High (Sensitive - 2.6 G):** For light elastic bands or gentle releases.
* **Center Aim Button:** Press to calibrate the center aiming point with the TV.
* **Tap to Test Fire Button:** Built-in emergency backup for manual testing.

---

## 🎨 Screen Features & Paintball Effects
* **Procedural Paint Splatter:** Every shot generates organic liquid splat shapes with drips and satellite droplets.
* **Polaroid Photo Stamp:** The selfie is stamped inside the paint splash with the chosen neon color border.
* **Graffiti Tag:** The user's custom message is rendered across the splash.
* **Built-in Web Audio Synthesizer:** Includes flying whoosh and wet paintball impact squish sounds (no external MP3 downloads required).
* **Photo Wall:** Splatters accumulate on the wall to create a visitor mosaic gallery during the event.
