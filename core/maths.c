/* The maths Stayput needs, written out so the WebAssembly build needs no C library and gives the
 * same answers as the native one. Each function is checked against the C library in the tests. */
#include "stayput.h"

#define PI 3.14159265358979323846
#define PIO2_HI 1.57079632679489655800e+00
#define PIO2_LO 6.12323399573676603587e-17
#define LN2_HI 6.93147180369123816490e-01
#define LN2_LO 1.90821492927058770002e-10

double sp_sqrt(double x) { return x > 0 ? __builtin_sqrt(x) : 0; }
double sp_fabs(double x) { return x < 0 ? -x : x; }

static double sin_poly(double r) {
  const double z = r * r;
  return r * (1 + z * (-1.0 / 6 + z * (1.0 / 120 + z * (-1.0 / 5040 + z * (1.0 / 362880 + z * (-1.0 / 39916800 +
         z * (1.0 / 6227020800.0 + z * (-1.0 / 1307674368000.0))))))));
}

static double cos_poly(double r) {
  const double z = r * r;
  return 1 + z * (-0.5 + z * (1.0 / 24 + z * (-1.0 / 720 + z * (1.0 / 40320 + z * (-1.0 / 3628800 +
         z * (1.0 / 479001600 + z * (-1.0 / 87178291200.0)))))));
}

/* x = k·π/2 + r with |r| <= π/4; returns k mod 4. Accurate for the |x| < 1e6 that Stayput uses. */
static int reduce(double x, double *r) {
  double kf = x * (2 / PI);
  kf = kf < 0 ? (double)(long long)(kf - 0.5) : (double)(long long)(kf + 0.5);
  *r = (x - kf * PIO2_HI) - kf * PIO2_LO;
  return (int)((long long)kf & 3);
}

double sp_sin(double x) {
  double r;
  switch (reduce(x, &r)) {
    case 0: return sin_poly(r);
    case 1: return cos_poly(r);
    case 2: return -sin_poly(r);
    default: return -cos_poly(r);
  }
}

double sp_cos(double x) {
  double r;
  switch (reduce(x, &r)) {
    case 0: return cos_poly(r);
    case 1: return -sin_poly(r);
    case 2: return -cos_poly(r);
    default: return sin_poly(r);
  }
}

typedef union {
  double d;
  uint64_t u;
} bits;

double sp_exp(double x) {
  if (x > 709) return 1e308;
  if (x < -745) return 0;
  double kf = x / (LN2_HI + LN2_LO);
  kf = kf < 0 ? (double)(long long)(kf - 0.5) : (double)(long long)(kf + 0.5);
  const double r = (x - kf * LN2_HI) - kf * LN2_LO; /* |r| <= ln2 / 2 */
  double term = 1, sum = 1;
  for (int n = 1; n <= 16; n++) {
    term *= r / n;
    sum += term;
  }
  /* Multiply by 2^k in two halves, so k near the ends of the range doesn't overflow the exponent. */
  const long long k = (long long)kf;
  const long long k1 = k / 2, k2 = k - k1;
  bits a = {.u = (uint64_t)(k1 + 1023) << 52}, b = {.u = (uint64_t)(k2 + 1023) << 52};
  return sum * a.d * b.d;
}

double sp_log(double x) {
  if (!(x > 0)) return -1e308;
  bits b = {.d = x};
  int e = (int)((b.u >> 52) & 0x7ff);
  if (e == 0) { /* subnormal: scale up first */
    b.d = x * 18014398509481984.0; /* 2^54 */
    e = (int)((b.u >> 52) & 0x7ff) - 54;
  }
  e -= 1023;
  b.u = (b.u & 0x000fffffffffffffULL) | 0x3ff0000000000000ULL; /* mantissa in [1, 2) */
  double m = b.d;
  if (m > 1.41421356237309504880) {
    m /= 2;
    e += 1;
  }
  const double s = (m - 1) / (m + 1), z = s * s;
  double term = s, sum = 0;
  for (int n = 1; n <= 31; n += 2) {
    sum += term / n;
    term *= z;
  }
  return 2 * sum + e * LN2_HI + e * LN2_LO;
}

double sp_atan(double x) {
  const int neg = x < 0;
  if (neg) x = -x;
  int inv = 0;
  if (x > 1) {
    x = 1 / x;
    inv = 1;
  }
  double base = 0;
  if (x > 0.2679491924311227) { /* tan(π/12): shift by π/6 */
    const double r3 = 1.7320508075688772;
    x = (x * r3 - 1) / (r3 + x);
    base = PI / 6;
  }
  const double z = x * x;
  double term = x, sum = 0;
  for (int n = 1; n <= 41; n += 2) {
    sum += (((n >> 1) & 1) ? -term : term) / n;
    term *= z;
  }
  double a = base + sum;
  if (inv) a = PI / 2 - a;
  return neg ? -a : a;
}

double sp_ncdf(double x) {
  if (x < -9) return 0;
  if (x > 9) return 1;
  /* Φ(x) = 1/2 + φ(x) (x + x³/3 + x⁵/(3·5) + ...), which converges for every x. */
  const double z = x * x;
  double term = x, sum = x;
  for (int n = 3; n < 400; n += 2) {
    term *= z / n;
    sum += term;
    if (sp_fabs(term) < 1e-17 * sp_fabs(sum)) break;
  }
  const double v = 0.5 + sum * sp_exp(-z / 2) * 0.39894228040143267794;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* ---------- PCG32 ---------- */

void sp_seed(sp_rng *r, uint64_t seed, uint64_t stream) {
  r->state = 0;
  r->inc = (stream << 1u) | 1u;
  r->has_spare = 0;
  r->spare = 0;
  (void)sp_next(r);
  r->state += seed;
  (void)sp_next(r);
}

uint32_t sp_next(sp_rng *r) {
  const uint64_t old = r->state;
  r->state = old * 6364136223846793005ULL + r->inc;
  const uint32_t xorshifted = (uint32_t)(((old >> 18u) ^ old) >> 27u);
  const uint32_t rot = (uint32_t)(old >> 59u);
  return (xorshifted >> rot) | (xorshifted << ((-rot) & 31u));
}

double sp_uniform(sp_rng *r) { return ((double)sp_next(r) + 0.5) / 4294967296.0; }

double sp_normal(sp_rng *r) {
  if (r->has_spare) {
    r->has_spare = 0;
    return r->spare;
  }
  const double u = sp_uniform(r), v = sp_uniform(r);
  const double m = sp_sqrt(-2 * sp_log(u));
  r->spare = m * sp_sin(2 * PI * v);
  r->has_spare = 1;
  return m * sp_cos(2 * PI * v);
}
