/* The WebAssembly interface. The page writes numbers into fixed buffers and calls these functions;
 * every argument is checked here again, so a bad call gets an error code, never a write outside a
 * buffer. Memory is fixed at build time and never grows. */
#include "stayput.h"

#define EXPORT(name) __attribute__((export_name(#name)))
#define FRAMES (SP_STEPS / 4) /* 50 frames a second for the animation */
#define ITEM_FIELDS 6
#define OUT_PER_ITEM (3 + 3 * SP_LEVELS)

static float g_ground[SP_MAX_RECORDS * 2 * SP_STEPS];
static int g_records = 0;
static double g_items[SP_MAX_ITEMS * ITEM_FIELDS];
static double g_out[SP_MAX_ITEMS * OUT_PER_ITEM];
static float g_trace[(2 + 2 * SP_MAX_ITEMS) * FRAMES];
static float g_work[3][SP_STEPS];

/* The compiler may call these for structure copies; there is no C library to provide them. */
void *memset(void *d, int c, size_t n) {
  unsigned char *p = d;
  while (n--) *p++ = (unsigned char)c;
  return d;
}
void *memcpy(void *d, const void *s, size_t n) {
  unsigned char *p = d;
  const unsigned char *q = s;
  while (n--) *p++ = *q++;
  return d;
}

EXPORT(sp_w_items) double *sp_w_items(void) { return g_items; }
EXPORT(sp_w_out) double *sp_w_out(void) { return g_out; }
EXPORT(sp_w_trace_buf) float *sp_w_trace_buf(void) { return g_trace; }
EXPORT(sp_w_frames) int sp_w_frames(void) { return FRAMES; }
EXPORT(sp_w_levels) int sp_w_levels(void) { return SP_LEVELS; }
EXPORT(sp_w_level) double sp_w_level(int i) { return i >= 0 && i < SP_LEVELS ? sp_levels[i] : 0; }

/* Makes nrec two-component ground records for a site. */
EXPORT(sp_w_generate) int sp_w_generate(uint32_t seed, int site, int nrec) {
  if (site < 0 || site > 2 || nrec < 1 || nrec > SP_MAX_RECORDS) return -1;
  sp_rng r;
  sp_seed(&r, seed, 54u);
  for (int i = 0; i < nrec; i++) {
    sp_ground(&r, site, g_ground + (size_t)i * 2 * SP_STEPS);
    sp_ground(&r, site, g_ground + (size_t)i * 2 * SP_STEPS + SP_STEPS);
  }
  g_records = nrec;
  return 0;
}

static int read_items(int n, sp_item *items, double *angles) {
  if (n < 1 || n > SP_MAX_ITEMS) return -1;
  for (int j = 0; j < n; j++) {
    const double *f = g_items + j * ITEM_FIELDS;
    items[j].depth = f[0];
    items[j].height = f[1];
    items[j].com = f[2];
    items[j].friction = f[3];
    items[j].backed = f[4] == 1.0 ? 1 : f[4] == 0.0 ? 0 : -1;
    angles[j] = f[5];
    if (sp_check_item(&items[j]) != 0) return -2;
    if (!(angles[j] > -100 && angles[j] < 100)) return -2;
  }
  return 0;
}

/* Fragility of every item in the room. Output per item: median (g), spread, records, then
 * topples, forwards and mean slide (m) at each level. */
EXPORT(sp_w_room) int sp_w_room(int n, int storeys, int floor) {
  static sp_item items[SP_MAX_ITEMS];
  static double angles[SP_MAX_ITEMS];
  static sp_fragility frag[SP_MAX_ITEMS];
  if (g_records < 1) return -4;
  const int bad = read_items(n, items, angles);
  if (bad) return bad;
  const int rc = sp_room(items, angles, n, g_ground, g_records, storeys, floor, frag);
  if (rc) return rc;
  for (int j = 0; j < n; j++) {
    double *o = g_out + j * OUT_PER_ITEM;
    o[0] = frag[j].median;
    o[1] = frag[j].beta;
    o[2] = frag[j].records;
    for (int l = 0; l < SP_LEVELS; l++) {
      o[3 + l] = frag[j].topples[l];
      o[3 + SP_LEVELS + l] = frag[j].forwards[l];
      o[3 + 2 * SP_LEVELS + l] = frag[j].slide[l];
    }
  }
  return 0;
}

/* One earthquake, for the animation: the floor's two accelerations, then each item's tilt and
 * slide, 50 frames a second. Outcomes go in the out buffer: outcome, forwards, time per item. */
EXPORT(sp_w_trace) int sp_w_trace(int n, int record, double pga, int storeys, int floor) {
  static sp_item items[SP_MAX_ITEMS];
  static double angles[SP_MAX_ITEMS];
  if (g_records < 1 || record < 0 || record >= g_records) return -4;
  if (!(pga >= 0.01 && pga <= 2.0) || storeys < 1 || storeys > 60 || floor < 0 || floor >= storeys) return -3;
  const int bad = read_items(n, items, angles);
  if (bad) return bad;
  const float *gx = g_ground + (size_t)record * 2 * SP_STEPS, *gy = gx + SP_STEPS;
  float *fx = g_work[0], *fy = g_work[1], *along = g_work[2];
  for (int i = 0; i < SP_STEPS; i++) along[i] = (float)(gx[i] * pga);
  sp_floor(along, storeys, floor, fx);
  for (int i = 0; i < SP_STEPS; i++) along[i] = (float)(gy[i] * pga);
  sp_floor(along, storeys, floor, fy);
  for (int f = 0; f < FRAMES; f++) {
    g_trace[f] = fx[f * 4];
    g_trace[FRAMES + f] = fy[f * 4];
  }
  static float pairs[2 * FRAMES];
  for (int j = 0; j < n; j++) {
    const double c = sp_cos(angles[j]), s = sp_sin(angles[j]);
    for (int i = 0; i < SP_STEPS; i++) along[i] = (float)(fx[i] * c + fy[i] * s);
    int got = 0;
    const sp_result r = sp_run(&items[j], along, 1.0, pairs, 4, &got);
    float *tilt = g_trace + (2 + 2 * j) * FRAMES, *slide = tilt + FRAMES;
    for (int f = 0; f < FRAMES; f++) {
      tilt[f] = f < got ? pairs[2 * f] : 0;
      slide[f] = f < got ? pairs[2 * f + 1] : 0;
    }
    g_out[j * 3] = r.outcome;
    g_out[j * 3 + 1] = r.forwards;
    g_out[j * 3 + 2] = r.when;
  }
  return FRAMES;
}

/* Probability from a fitted curve, so the page uses the same normal distribution as the core. */
EXPORT(sp_w_prob) double sp_w_prob(double median, double beta, double pga) { return sp_prob(median, beta, pga); }

/* The geometry of one item (alpha in radians, tan alpha, Housner restitution), for the method page. */
EXPORT(sp_w_shape) int sp_w_shape(void) {
  sp_item it;
  double a;
  if (read_items(1, &it, &a)) return -2;
  const sp_shape s = sp_shape_of(&it);
  g_out[0] = s.alpha;
  g_out[1] = sp_sin(s.alpha) / sp_cos(s.alpha);
  g_out[2] = s.restore;
  g_out[3] = sp_sqrt(s.p2);
  return 0;
}
