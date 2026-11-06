/* Fragility: how the chance of toppling grows with the strength of the shaking, from Monte Carlo
 * over many synthetic earthquakes, summarised as a lognormal curve. */
#include "stayput.h"

const double sp_levels[SP_LEVELS] = {0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40,
                                     0.50, 0.60, 0.70, 0.80, 0.90, 1.00, 1.10, 1.20};

double sp_prob(double median, double beta, double pga) {
  if (!(pga > 0)) return 0;
  if (median >= 1e8) return 0;
  if (beta <= 0) return pga >= median ? 1 : 0;
  return sp_ncdf(sp_log(pga / median) / beta);
}

static double loglik(const double *x, const int *k, int n, int count, double lm, double beta) {
  double L = 0;
  for (int i = 0; i < count; i++) {
    double p = sp_ncdf((sp_log(x[i]) - lm) / beta);
    if (p < 1e-12) p = 1e-12;
    if (p > 1 - 1e-12) p = 1 - 1e-12;
    L += k[i] * sp_log(p) + (n - k[i]) * sp_log(1 - p);
  }
  return L;
}

void sp_fit(const double *x, const int *k, int n, int count, double *median, double *beta) {
  int any = 0, all = 1;
  for (int i = 0; i < count; i++) {
    if (k[i] > 0) any = 1;
    if (k[i] < n) all = 0;
  }
  if (!any || n <= 0) {
    *median = 1e9;
    *beta = 0;
    return;
  }
  /* A coarse grid over log-median and spread, then two finer grids around the best point. */
  double lo_m = sp_log(0.01), hi_m = sp_log(10.0), lo_b = 0.05, hi_b = 2.0;
  double best_m = 0, best_b = 0.5, best = -1e300;
  for (int round = 0; round < 4; round++) {
    const int G = 48;
    for (int a = 0; a <= G; a++) {
      const double lm = lo_m + (hi_m - lo_m) * a / G;
      for (int b = 0; b <= G; b++) {
        const double bt = lo_b + (hi_b - lo_b) * b / G;
        const double L = loglik(x, k, n, count, lm, bt);
        if (L > best) {
          best = L;
          best_m = lm;
          best_b = bt;
        }
      }
    }
    const double wm = (hi_m - lo_m) / G * 3, wb = (hi_b - lo_b) / G * 3;
    lo_m = best_m - wm;
    hi_m = best_m + wm;
    lo_b = best_b - wb > 0.02 ? best_b - wb : 0.02;
    hi_b = best_b + wb;
  }
  (void)all;
  *median = sp_exp(best_m);
  *beta = best_b;
}

int sp_room(const sp_item *items, const double *angles, int nitems, const float *ground, int nrec, int storeys, int floor,
            sp_fragility *out) {
  if (nitems < 1 || nitems > SP_MAX_ITEMS || nrec < 1 || nrec > SP_MAX_RECORDS) return -1;
  if (storeys < 1 || storeys > 60 || floor < 0 || floor >= storeys) return -2;
  for (int j = 0; j < nitems; j++) {
    if (sp_check_item(&items[j]) != 0) return -3;
  }
  static float fx[SP_STEPS], fy[SP_STEPS], scaled[SP_STEPS], along[SP_STEPS];
  double cs[SP_MAX_ITEMS], sn[SP_MAX_ITEMS], start[SP_MAX_ITEMS];
  for (int j = 0; j < nitems; j++) {
    cs[j] = sp_cos(angles[j]);
    sn[j] = sp_sin(angles[j]);
    const sp_shape s = sp_shape_of(&items[j]);
    const double tip = sp_sin(s.alpha) / sp_cos(s.alpha);
    start[j] = items[j].friction < tip ? items[j].friction : tip; /* below this nothing happens */
    for (int l = 0; l < SP_LEVELS; l++) {
      out[j].topples[l] = 0;
      out[j].forwards[l] = 0;
      out[j].slide[l] = 0;
    }
    out[j].records = nrec;
  }
  for (int r = 0; r < nrec; r++) {
    const float *gx = ground + (size_t)r * 2 * SP_STEPS, *gy = gx + SP_STEPS;
    for (int l = 0; l < SP_LEVELS; l++) {
      /* The floor's motion depends on the level (the building yields), so it is worked out per level. */
      for (int i = 0; i < SP_STEPS; i++) scaled[i] = (float)((double)gx[i] * sp_levels[l]);
      sp_floor(scaled, storeys, floor, fx);
      for (int i = 0; i < SP_STEPS; i++) scaled[i] = (float)((double)gy[i] * sp_levels[l]);
      sp_floor(scaled, storeys, floor, fy);
      for (int j = 0; j < nitems; j++) {
        double peak = 0;
        for (int i = 0; i < SP_STEPS; i++) {
          along[i] = (float)((double)fx[i] * cs[j] + (double)fy[i] * sn[j]);
          const double m = sp_fabs(along[i]);
          if (m > peak) peak = m;
        }
        if (peak <= start[j]) continue; /* too gentle to move it at all */
        const sp_result res = sp_run(&items[j], along, 1.0, 0, 0, 0);
        if (res.outcome == SP_TOPPLED) {
          out[j].topples[l]++;
          out[j].forwards[l] += res.forwards;
        }
        out[j].slide[l] += res.slide / nrec;
      }
    }
  }
  for (int j = 0; j < nitems; j++) sp_fit(sp_levels, out[j].topples, nrec, SP_LEVELS, &out[j].median, &out[j].beta);
  return 0;
}
