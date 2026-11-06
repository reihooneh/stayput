/* Earthquake shaking: synthetic ground records for a soil type, and the motion they cause on an
 * upper floor of a building. */
#include "stayput.h"

#define PI 3.14159265358979323846

/* Kanai–Tajimi soil filters (frequency rad/s, damping), after Der Kiureghian and Neuenhofer (1992):
 * firm, medium and soft ground. The Clough–Penzien filter takes out the very low frequencies the
 * Kanai–Tajimi filter lets through, at a tenth of the soil frequency. */
static const double kSoilW[3] = {15.0, 10.0, 5.0};
static const double kSoilZ[3] = {0.6, 0.4, 0.2};

/* Build-up, strong shaking, decay. */
static double envelope(double t) {
  if (t < 2.0) return (t / 2.0) * (t / 2.0);
  if (t < 7.0) return 1.0;
  return sp_exp(-0.25 * (t - 7.0));
}

void sp_ground(sp_rng *r, int site, float *out) {
  if (site < 0 || site > 2) site = SP_FIRM;
  const double wg = kSoilW[site], zg = kSoilZ[site];
  const double wf = 0.1 * wg, zf = zg;
  const double dt = SP_DT;
  const int sub = 4; /* sub-steps per sample keep the filters accurate */
  const double h = dt / sub;
  /* A second-order low-pass at 20 Hz stands in for the loss of high frequencies real records show. */
  const double wl = 2 * PI * 20.0, zl = 0.7071;
  double x1 = 0, v1 = 0, x2 = 0, v2 = 0, x3 = 0, v3 = 0, peak = 0;
  static double tmp[SP_STEPS];
  for (int i = 0; i < SP_STEPS; i++) {
    const double w = sp_normal(r) / sp_sqrt(dt) * envelope(i * dt);
    double a = 0;
    for (int s = 0; s < sub; s++) {
      /* Kanai–Tajimi: x1'' + 2 zg wg x1' + wg² x1 = -w; its output is the soil's acceleration. */
      const double acc1 = -w - 2 * zg * wg * v1 - wg * wg * x1;
      v1 += h * acc1;
      x1 += h * v1;
      const double soil = -(2 * zg * wg * v1 + wg * wg * x1);
      /* Clough–Penzien high-pass: x2'' + 2 zf wf x2' + wf² x2 = soil; output x2''. */
      const double acc2 = soil - 2 * zf * wf * v2 - wf * wf * x2;
      v2 += h * acc2;
      x2 += h * v2;
      const double acc3 = wl * wl * (acc2 - x3) - 2 * zl * wl * v3;
      v3 += h * acc3;
      x3 += h * v3;
      a = x3;
    }
    tmp[i] = a;
    if (sp_fabs(a) > peak) peak = sp_fabs(a);
  }
  const double k = peak > 0 ? 1.0 / peak : 0;
  for (int i = 0; i < SP_STEPS; i++) out[i] = (float)(tmp[i] * k);
}

/* The building's first mode: an oscillator with period 0.1 s per storey and 5 % damping, whose
 * spring yields at kYield g, as a real building's structure does in strong shaking (an
 * elastic–perfectly-plastic spring). Floor k of an N-storey building moves with mode shape k/N,
 * and the mode's participation factor for a straight-line shape is 3N/(2N+1). */
#define kZeta 0.05
#define kYield 0.35

void sp_floor_ex(const float *ground, int storeys, int floor, double yield_g, float *out) {
  if (storeys < 1) storeys = 1;
  if (floor < 0) floor = 0;
  if (floor > storeys - 1) floor = storeys - 1;
  const double phi = (double)floor / storeys;
  const double gamma = 3.0 * storeys / (2.0 * storeys + 1.0);
  const double T = 0.1 * storeys, w = 2 * PI / T;
  const int sub = 16;
  const double h = SP_DT / sub;
  double v = 0, fs = 0; /* relative velocity, and spring force per unit mass (g) */
  double prev = ground[0];
  for (int i = 0; i < SP_STEPS; i++) {
    const double next = ground[i];
    double rel = 0;
    for (int s = 0; s < sub; s++) {
      const double ag = prev + (next - prev) * (s + 1) / sub;
      rel = -ag - 2 * kZeta * w * v - fs;
      v += h * rel;
      fs += w * w * h * v; /* the spring force follows the displacement step */
      if (fs > yield_g) fs = yield_g;
      if (fs < -yield_g) fs = -yield_g;
    }
    prev = next;
    out[i] = (float)(next + gamma * phi * rel);
  }
}

void sp_floor(const float *ground, int storeys, int floor, float *out) {
  sp_floor_ex(ground, storeys, floor, kYield, out);
}
