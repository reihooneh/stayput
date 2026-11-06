/* Stayput: how likely a piece of furniture is to topple in an earthquake, on a given floor of a
 * given building, and which way it falls.
 *
 * The core is plain C17 with no libc in the WebAssembly build (it brings its own maths), so the
 * same code runs natively for the tests and in the browser.
 *
 * Units: metres, seconds, kilograms; accelerations in m/s² unless named "_g" (multiples of g). */
#ifndef STAYPUT_H
#define STAYPUT_H

#include <stddef.h>
#include <stdint.h>

#define SP_G 9.80665

/* Ground motions: 15 s at 200 samples a second, two horizontal components. */
#define SP_DT 0.005
#define SP_STEPS 3000
#define SP_MAX_RECORDS 64
#define SP_MAX_ITEMS 24

/* Shaking levels for fragility curves: peak ground acceleration from 0.05 g to 1.2 g. */
#define SP_LEVELS 16

enum sp_site { SP_ROCK = 0, SP_FIRM = 1, SP_SOFT = 2 };

/* ---------- Small maths, the same natively and in WebAssembly ---------- */
double sp_sqrt(double x);
double sp_sin(double x);
double sp_cos(double x);
double sp_exp(double x);
double sp_log(double x);
double sp_atan(double x);
double sp_fabs(double x);
double sp_ncdf(double x); /* the standard normal distribution function */

/* A small, fast generator (PCG32) with Box–Muller normals. */
typedef struct {
  uint64_t state;
  uint64_t inc;
  int has_spare;
  double spare;
} sp_rng;
void sp_seed(sp_rng *r, uint64_t seed, uint64_t stream);
uint32_t sp_next(sp_rng *r);
double sp_uniform(sp_rng *r); /* in (0, 1) */
double sp_normal(sp_rng *r);

/* ---------- Earthquake shaking ---------- */

/* A synthetic ground acceleration record: white noise through the Kanai–Tajimi and Clough–Penzien
 * filters for the site's soil, shaped by a build-up / strong / decay envelope and scaled so its peak
 * is exactly 1 g. Writes SP_STEPS values (in g). */
void sp_ground(sp_rng *r, int site, float *out);

/* The motion on a floor of a building: the ground motion plus the building's own sway, modelled as
 * its first mode (a damped oscillator with period 0.1 s per storey and a straight-line mode shape).
 * floor 0 is the ground floor, where the motion is the ground's. In-place is allowed. */
void sp_floor(const float *ground, int storeys, int floor, float *out);
/* The same with the building's yield strength given (in g); a huge value keeps it elastic. */
void sp_floor_ex(const float *ground, int storeys, int floor, double yield_g, float *out);

/* ---------- One piece of furniture ---------- */

typedef struct {
  double depth;    /* front to back (m): the narrow way it rocks */
  double height;   /* (m) */
  double com;      /* centre of mass height as a fraction of the height (0.2 to 0.8) */
  double friction; /* coefficient between its feet and the floor */
  int backed;      /* 1 if it stands flat against a wall behind it, so it can only fall forwards */
} sp_item;

/* 0 if the item is sensible, otherwise a negative code (see stayput.c). */
int sp_check_item(const sp_item *it);

/* The geometry of rocking. */
typedef struct {
  double alpha;   /* slenderness angle: atan(half depth / centre-of-mass height) */
  double R;       /* distance from a bottom edge to the centre of mass */
  double p2;      /* m g R / I about the edge (1/s²) */
  double ratio;   /* m R² / I */
  double restore; /* angular velocity kept at each impact (Housner) */
} sp_shape;
sp_shape sp_shape_of(const sp_item *it);

enum sp_outcome { SP_STILL = 0, SP_ROCKED = 1, SP_SLID = 2, SP_TOPPLED = 3 };

typedef struct {
  int outcome;
  int forwards;     /* when toppled: 1 forwards, 0 backwards */
  double peak;      /* largest tilt as a fraction of alpha (1 = tipping point) */
  double slide;     /* largest sliding distance (m) */
  double when;      /* time it toppled (s), or -1 */
} sp_result;

/* Runs one item through one acceleration history (in g, already scaled) along its rocking axis.
 * If trace is not NULL, writes the tilt (radians, + forwards) every `every` steps, continuing the
 * fall to the floor after a topple; returns the number of trace values written in *ntrace. */
sp_result sp_run(const sp_item *it, const float *accel_g, double scale, float *trace, int every, int *ntrace);

/* ---------- Fragility ---------- */

extern const double sp_levels[SP_LEVELS]; /* peak ground accelerations (g) */

typedef struct {
  int topples[SP_LEVELS];  /* how many records toppled it, at each level */
  int forwards[SP_LEVELS]; /* of those, how many fell forwards */
  double slide[SP_LEVELS]; /* mean largest slide (m) */
  int records;
  double median; /* lognormal fragility: the shaking (g) with a 50 % chance of toppling */
  double beta;   /* and its spread */
} sp_fragility;

/* Monte Carlo for a whole room: every record (two components each, SP_STEPS values apiece, at a
 * peak of 1 g) at every level, through the building to the floor, projected onto each item's
 * rocking axis (angles in radians); then a maximum-likelihood lognormal fit per item.
 * Returns 0, or a negative code for bad arguments. */
int sp_room(const sp_item *items, const double *angles, int nitems, const float *ground, int nrec, int storeys, int floor,
            sp_fragility *out);

/* Lognormal fit of counts k[i] out of n at levels x[i]: maximum likelihood over a fine grid, then
 * Newton steps. If nothing ever topples, median is +infinity-like (1e9) and beta 0. */
void sp_fit(const double *x, const int *k, int n, int count, double *median, double *beta);

/* P(topple) at peak ground acceleration pga (g) from a fitted curve. */
double sp_prob(double median, double beta, double pga);

#endif
