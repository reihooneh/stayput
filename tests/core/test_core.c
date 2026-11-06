/* Tests for the Stayput core, built natively with AddressSanitizer and UBSan. */
#define _USE_MATH_DEFINES
#include <math.h>
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../core/stayput.h"

static int checks = 0, failed = 0;
#define CHECK(cond, ...)                 \
  do {                                   \
    ++checks;                            \
    if (!(cond)) {                       \
      ++failed;                          \
      printf("FAIL %s:%d: ", __FILE__, __LINE__); \
      printf(__VA_ARGS__);               \
      printf("\n");                      \
    }                                    \
  } while (0)

static float pulse[SP_STEPS];

static sp_item box(double depth, double height) {
  sp_item it = {depth, height, 0.5, 0.6, 0, };
  return it;
}

static void test_maths(void) {
  double worst = 0;
  for (double x = -40; x <= 40; x += 0.0137) {
    worst = fmax(worst, fabs(sp_sin(x) - sin(x)));
    worst = fmax(worst, fabs(sp_cos(x) - cos(x)));
    worst = fmax(worst, fabs(sp_atan(x) - atan(x)));
  }
  CHECK(worst < 1e-13, "sin, cos, atan agree with the C library (worst %g)", worst);
  worst = 0;
  for (double x = -700; x <= 700; x += 0.731) worst = fmax(worst, fabs(sp_exp(x) - exp(x)) / exp(x));
  CHECK(worst < 1e-13, "exp to 13 digits (worst relative %g)", worst);
  worst = 0;
  for (double x = 1e-300; x < 1e300; x *= 7.3) worst = fmax(worst, fabs(sp_log(x) - log(x)));
  CHECK(worst < 1e-12, "log (worst %g)", worst);
  CHECK(fabs(sp_log(5e-320) - log(5e-320)) < 1e-9, "log of a subnormal");
  worst = 0;
  for (double x = -8; x <= 8; x += 0.01) worst = fmax(worst, fabs(sp_ncdf(x) - 0.5 * erfc(-x / sqrt(2))));
  CHECK(worst < 1e-12, "normal distribution (worst %g)", worst);

  sp_rng r;
  sp_seed(&r, 42, 1);
  double s = 0, s2 = 0;
  const int N = 200000;
  for (int i = 0; i < N; i++) {
    const double z = sp_normal(&r);
    s += z;
    s2 += z * z;
  }
  CHECK(fabs(s / N) < 0.01 && fabs(s2 / N - 1) < 0.02, "normals have mean 0 and variance 1 (%g, %g)", s / N, s2 / N);
  sp_rng a, b;
  sp_seed(&a, 7, 3);
  sp_seed(&b, 7, 3);
  int same = 1;
  for (int i = 0; i < 1000; i++) same &= sp_next(&a) == sp_next(&b);
  CHECK(same, "the same seed gives the same numbers");
}

static void test_motion(void) {
  static float g[SP_STEPS], f[SP_STEPS];
  sp_rng r;
  for (int site = 0; site < 3; site++) {
    sp_seed(&r, 100 + (uint64_t)site, 9);
    double crossings = 0, mean_peak = 0;
    for (int rec = 0; rec < 20; rec++) {
      sp_ground(&r, site, g);
      double peak = 0;
      for (int i = 0; i < SP_STEPS; i++) peak = fmax(peak, fabs(g[i]));
      mean_peak += peak / 20;
      for (int i = 1; i < SP_STEPS; i++) crossings += (g[i - 1] < 0) != (g[i] < 0);
    }
    CHECK(fabs(mean_peak - 1) < 1e-6, "records are scaled to a peak of exactly 1 g (site %d)", site);
    /* Zero crossings per second, roughly the soil's frequency over pi. */
    const double rate = crossings / 20 / (SP_STEPS * SP_DT);
    const double expect[3] = {15.0 / M_PI, 10.0 / M_PI, 5.0 / M_PI};
    CHECK(rate > 1.0 * expect[site] && rate < 4.0 * expect[site], "site %d: %.1f crossings a second, expected about %.1f", site, rate,
          expect[site]);
  }

  sp_seed(&r, 5, 5);
  sp_ground(&r, SP_FIRM, g);
  sp_floor(g, 10, 0, f);
  int same = 1;
  for (int i = 0; i < SP_STEPS; i++) same &= f[i] == g[i];
  CHECK(same, "the ground floor moves with the ground");

  /* A steady sine at the building's own period: the top floor's motion grows to
   * sqrt(1 + (Γ/2ζ)²) times the ground's when the building stays elastic. */
  const int N = 10;
  const double T = 0.1 * N, w = 2 * M_PI / T, gamma = 3.0 * N / (2.0 * N + 1);
  for (int i = 0; i < SP_STEPS; i++) g[i] = (float)(0.01 * sin(w * i * SP_DT));
  sp_floor_ex(g, N, N, 1e9, f); /* N is clamped to the top floor, N-1 */
  double peak = 0;
  for (int i = SP_STEPS - 400; i < SP_STEPS; i++) peak = fmax(peak, fabs(f[i]));
  const double phi = (N - 1.0) / N;
  const double want = 0.01 * sqrt(1 + pow(gamma * phi / (2 * 0.05), 2));
  CHECK(fabs(peak - want) / want < 0.06, "resonance on the top floor: %.4f g, theory %.4f g", peak, want);
  for (int i = 0; i < SP_STEPS; i++) g[i] = (float)(0.5 * sin(w * i * SP_DT));
  sp_floor(g, N, N - 1, f);
  peak = 0;
  for (int i = SP_STEPS - 400; i < SP_STEPS; i++) peak = fmax(peak, fabs(f[i]));
  CHECK(peak < 0.5 * fabs(1 - gamma * phi) + gamma * phi * 0.5, "a yielding building limits the top floor's motion (%.2f g)", peak);
  CHECK(peak > 0.3, "but it still moves (%.2f g)", peak);
}

static void constant(double a) {
  for (int i = 0; i < SP_STEPS; i++) pulse[i] = (float)(i < 400 ? a : 0);
}

static void test_rocking(void) {
  /* A 0.4 m deep, 1.8 m tall bookcase: tan(alpha) = 0.2 / 0.9. */
  sp_item it = box(0.4, 1.8);
  const sp_shape s = sp_shape_of(&it);
  const double tip = 0.2 / 0.9;
  CHECK(fabs(tan(s.alpha) - tip) < 1e-12, "slenderness angle");
  CHECK(fabs(s.restore - (1 - 1.5 * sin(s.alpha) * sin(s.alpha))) < 1e-12, "Housner's restitution for a uniform box");
  CHECK(fabs(s.p2 - 3 * SP_G / (4 * s.R)) < 1e-9, "Housner's frequency parameter p² = 3g/4R");

  constant(-0.99 * tip);
  sp_result r = sp_run(&it, pulse, 1.0, 0, 0, 0);
  CHECK(r.outcome == SP_STILL, "just below g·tan(alpha) it stays put (%d)", r.outcome);
  constant(-1.05 * tip);
  r = sp_run(&it, pulse, 1.0, 0, 0, 0);
  CHECK(r.outcome >= SP_ROCKED, "just above it rocks (%d)", r.outcome);

  /* A long, steady push well past the threshold: the effective gravity leans past the edge. */
  for (int i = 0; i < SP_STEPS; i++) pulse[i] = (float)(-2 * tip);
  r = sp_run(&it, pulse, 1.0, 0, 0, 0);
  CHECK(r.outcome == SP_TOPPLED && r.forwards == 1, "a steady push topples it forwards");
  for (int i = 0; i < SP_STEPS; i++) pulse[i] = (float)(2 * tip);
  r = sp_run(&it, pulse, 1.0, 0, 0, 0);
  CHECK(r.outcome == SP_TOPPLED && r.forwards == 0, "and the other way backwards");
  it.backed = 1;
  r = sp_run(&it, pulse, 1.0, 0, 0, 0);
  CHECK(r.outcome == SP_STILL, "a wall behind stops it falling backwards (%d)", r.outcome);
  it.backed = 0;

  /* Free rocking: after one impact the spin is multiplied by the restitution. Start by a short kick. */
  for (int i = 0; i < SP_STEPS; i++) pulse[i] = (float)(i < 20 ? -3 * tip : 0);
  static float tr[2 * SP_STEPS];
  int n = 0;
  r = sp_run(&it, pulse, 1.0, tr, 1, &n);
  CHECK(r.outcome == SP_ROCKED && n == SP_STEPS, "a short kick only rocks it (%d)", r.outcome);
  double amp1 = 0, amp2 = 0;
  int i = 0;
  while (i < n && !(tr[2 * i] > 0)) i++;
  for (; i < n && tr[2 * i] > 0; i++) amp1 = fmax(amp1, tr[2 * i]);
  for (; i < n && tr[2 * i] <= 0; i++) amp2 = fmax(amp2, -tr[2 * i]);
  CHECK(amp1 > 0 && amp2 > 0 && amp2 < amp1, "each swing is smaller than the last (%.4f, %.4f rad)", amp1, amp2);

  /* Sliding: low friction, so it slides rather than rocks. */
  sp_item slippery = box(0.6, 0.8);
  slippery.friction = 0.2;
  constant(0.3);
  r = sp_run(&slippery, pulse, 1.0, 0, 0, 0);
  CHECK(r.outcome == SP_SLID && r.slide > 0, "a squat, slippery chest slides (%d, %.3f m)", r.outcome, r.slide);
  /* Sliding under a 0.3 g push for 2 s against 0.2 g friction: 0.1 g, then decelerating at 0.2 g. */
  const double v = 0.1 * SP_G * 2.0;
  const double want = 0.5 * 0.1 * SP_G * 4.0 + v * v / (2 * 0.2 * SP_G);
  CHECK(fabs(r.slide - want) / want < 0.02, "slide distance %.3f m, by hand %.3f m", r.slide, want);
}

/* Housner's size effect: of two boxes with the same shape, the bigger one is harder to topple. */
static void test_size_effect(void) {
  static float g[SP_MAX_RECORDS * 2 * SP_STEPS];
  sp_rng r;
  sp_seed(&r, 2024, 7);
  const int nrec = 24;
  for (int i = 0; i < 2 * nrec; i++) sp_ground(&r, SP_FIRM, g + (size_t)i * SP_STEPS);
  sp_item items[3] = {box(0.15, 0.6), box(0.3, 1.2), box(0.6, 2.4)};
  double angles[3] = {0, 0, 0};
  sp_fragility f[3];
  CHECK(sp_room(items, angles, 3, g, nrec, 1, 0, f) == 0, "room runs");
  CHECK(f[0].median < f[1].median && f[1].median < f[2].median, "size effect: medians %.3f < %.3f < %.3f g", f[0].median, f[1].median,
        f[2].median);
  for (int k = 0; k < 3; k++) {
    int mono = 1;
    for (int l = 1; l < SP_LEVELS; l++) mono &= f[k].topples[l] + 2 >= f[k].topples[l - 1];
    CHECK(mono, "box %d: stronger shaking topples it at least about as often", k);
  }
  /* Upper floors of a tall building shake harder than the ground at moderate levels. */
  sp_fragility up[1];
  CHECK(sp_room(&items[1], angles, 1, g, nrec, 8, 7, up) == 0, "upper floor runs");
  CHECK(up[0].median < f[1].median, "the 8th floor topples it at weaker ground shaking (%.3f g vs %.3f g)", up[0].median, f[1].median);
  /* Against a wall it can only fall one way, so it falls less. */
  items[1].backed = 1;
  sp_fragility wall[1];
  CHECK(sp_room(&items[1], angles, 1, g, nrec, 1, 0, wall) == 0, "backed runs");
  int fewer = 0, total = 0;
  for (int l = 0; l < SP_LEVELS; l++) {
    fewer += wall[0].topples[l];
    total += f[1].topples[l];
    CHECK(wall[0].forwards[l] == wall[0].topples[l], "against a wall every topple is forwards");
  }
  CHECK(fewer < total, "against a wall it topples less often (%d vs %d)", fewer, total);
  /* Turning an item turns which component of the shaking it feels, but not its overall fragility much. */
  double turned[1] = {1.2};
  sp_fragility t[1];
  items[1].backed = 0;
  CHECK(sp_room(&items[1], turned, 1, g, nrec, 1, 0, t) == 0 && fabs(log(t[0].median / f[1].median)) < 0.5, "turned 70°: %.3f g vs %.3f g",
        t[0].median, f[1].median);
}

static void test_fit(void) {
  /* Counts that follow a known curve exactly (100 records each) come back as that curve. */
  int k[SP_LEVELS];
  const int n = 1000;
  for (int l = 0; l < SP_LEVELS; l++) k[l] = (int)lround(n * sp_prob(0.42, 0.35, sp_levels[l]));
  double m, b;
  sp_fit(sp_levels, k, n, SP_LEVELS, &m, &b);
  CHECK(fabs(m - 0.42) < 0.005 && fabs(b - 0.35) < 0.01, "fit recovers median 0.42 g and spread 0.35 (%.4f, %.4f)", m, b);
  for (int l = 0; l < SP_LEVELS; l++) k[l] = 0;
  sp_fit(sp_levels, k, n, SP_LEVELS, &m, &b);
  CHECK(m >= 1e8 && sp_prob(m, b, 1.2) == 0, "never toppled: zero probability");
  CHECK(sp_prob(0.5, 0, 0.6) == 1 && sp_prob(0.5, 0, 0.4) == 0, "zero spread is a step");
  CHECK(fabs(sp_prob(0.5, 0.4, 0.5) - 0.5) < 1e-12, "50 %% at the median");
}

static void test_bad_arguments(void) {
  sp_item bad[] = {{0.01, 1, 0.5, 0.5, 0}, {0.4, 9, 0.5, 0.5, 0}, {0.4, 1, 0.95, 0.5, 0}, {0.4, 1, 0.5, 3, 0}, {0.4, 1, 0.5, 0.5, 2},
                   {NAN, 1, 0.5, 0.5, 0}};
  for (size_t i = 0; i < sizeof bad / sizeof *bad; i++) CHECK(sp_check_item(&bad[i]) < 0, "bad item %zu refused", i);
  CHECK(sp_check_item(0) < 0, "a null item is refused");
  sp_result r = sp_run(&bad[0], pulse, 1, 0, 0, 0);
  CHECK(r.outcome == SP_STILL, "running a bad item does nothing");
  static float g[2 * SP_STEPS];
  sp_item ok = box(0.4, 1.8);
  double a = 0;
  sp_fragility f;
  CHECK(sp_room(&ok, &a, 0, g, 1, 1, 0, &f) < 0, "no items");
  CHECK(sp_room(&ok, &a, 1, g, 0, 1, 0, &f) < 0, "no records");
  CHECK(sp_room(&ok, &a, 1, g, SP_MAX_RECORDS + 1, 1, 0, &f) < 0, "too many records");
  CHECK(sp_room(&ok, &a, 1, g, 1, 3, 3, &f) < 0, "a floor above the roof");
  CHECK(sp_room(&ok, &a, 1, g, 1, 61, 0, &f) < 0, "too many storeys");
  CHECK(sp_room(&bad[3], &a, 1, g, 1, 1, 0, &f) < 0, "a bad item in a room");
}

/* Random items, including nonsense ones, through random shaking: nothing may crash, read out of
 * bounds or produce a tilt beyond lying flat. Runs under the sanitizers. */
static void test_random(void) {
  sp_rng r;
  sp_seed(&r, 99, 99);
  static float g[SP_STEPS], tr[2 * SP_STEPS];
  int bad_ok = 1, bounded = 1;
  for (int round = 0; round < 400; round++) {
    sp_item it = {sp_uniform(&r) * 2.2 - 0.1, sp_uniform(&r) * 3.4 - 0.2, sp_uniform(&r), sp_uniform(&r) * 1.7, (int)(sp_next(&r) % 3)};
    for (int i = 0; i < SP_STEPS; i++) g[i] = (float)(sp_normal(&r) * (sp_uniform(&r) < 0.01 ? 50 : 1));
    int n = 0;
    const sp_result res = sp_run(&it, g, sp_uniform(&r) * 3, tr, (int)(sp_next(&r) % 5), &n);
    if (sp_check_item(&it) != 0) bad_ok &= res.outcome == SP_STILL && n == 0;
    for (int i = 0; i < n; i++) bounded &= fabs(tr[2 * i]) <= 1.5708 + 1e-6 && isfinite(tr[2 * i + 1]);
    bounded &= res.peak >= 0 && res.peak <= 1 && isfinite(res.slide);
  }
  CHECK(bad_ok, "invalid random items are refused without running");
  CHECK(bounded, "random runs stay finite, and a tilt never goes past lying flat");
}

int main(void) {
  test_random();
  test_maths();
  test_motion();
  test_rocking();
  test_size_effect();
  test_fit();
  test_bad_arguments();
  printf("%d checks, %d failed\n", checks, failed);
  return failed ? 1 : 0;
}
