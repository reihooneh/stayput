/* A free-standing piece of furniture on a shaking floor: it stays put, slides, rocks on its front
 * or back edge, or topples. Rocking follows Housner (1963): a rigid block pivoting on one bottom
 * edge, losing a fixed share of its spin each time it lands back on its base. */
#include "stayput.h"

#define PI 3.14159265358979323846

int sp_check_item(const sp_item *it) {
  if (!it) return -1;
  if (!(it->depth >= 0.05 && it->depth <= 2.0)) return -2;
  if (!(it->height >= 0.1 && it->height <= 3.0)) return -3;
  if (!(it->com >= 0.2 && it->com <= 0.8)) return -4;
  if (!(it->friction >= 0.05 && it->friction <= 1.5)) return -5;
  if (it->backed != 0 && it->backed != 1) return -6;
  return 0;
}

sp_shape sp_shape_of(const sp_item *it) {
  sp_shape s;
  const double b = it->depth / 2, h = it->com * it->height;
  s.alpha = sp_atan(b / h);
  s.R = sp_sqrt(b * b + h * h);
  /* Moment of inertia about the pivot edge per unit mass: a uniform box's own inertia about its
   * middle, (depth² + height²)/12, moved to the edge through the centre of mass. */
  const double I = (it->depth * it->depth + it->height * it->height) / 12.0 + s.R * s.R;
  s.p2 = SP_G * s.R / I;
  s.ratio = s.R * s.R / I;
  const double sa = sp_sin(s.alpha);
  s.restore = 1.0 - 2.0 * s.ratio * sa * sa; /* Housner's angular momentum balance at impact */
  if (s.restore < 0) s.restore = 0;
  return s;
}

/* Angular acceleration while rocking. a is the floor's acceleration in g along the item's depth,
 * positive when the floor moves forwards (which throws the item backwards). theta > 0 is a forward
 * tilt on the front edge, theta < 0 a backward tilt on the back edge. */
static double rock_acc(const sp_shape *s, double theta, double a) {
  if (theta >= 0) return -s->p2 * (sp_sin(s->alpha - theta) + a * sp_cos(s->alpha - theta));
  return s->p2 * (sp_sin(s->alpha + theta) - a * sp_cos(s->alpha + theta));
}

sp_result sp_run(const sp_item *it, const float *accel_g, double scale, float *trace, int every, int *ntrace) {
  sp_result res = {SP_STILL, 0, 0, 0, -1};
  if (ntrace) *ntrace = 0;
  if (sp_check_item(it) != 0) return res;
  const sp_shape s = sp_shape_of(it);
  const double tip = sp_sin(s.alpha) / sp_cos(s.alpha); /* tan(alpha): the acceleration that starts rocking */
  const int slides = it->friction < tip;                 /* it slides before it can rock */
  const int sub = 4;
  const double h = SP_DT / sub;
  int mode = 0; /* 0 at rest, 1 rocking, 2 sliding, 3 toppled (falling), 4 lying on the floor */
  double th = 0, om = 0, u = 0, uv = 0;
  int written = 0;
  double prev = (double)accel_g[0] * scale;
  for (int i = 0; i < SP_STEPS; i++) {
    const double next = (double)accel_g[i] * scale;
    for (int k = 0; k < sub; k++) {
      const double a0 = prev + (next - prev) * k / sub, a1 = prev + (next - prev) * (k + 1) / sub;
      const double am = 0.5 * (a0 + a1);
      if (mode == 0) {
        if (slides) {
          if (sp_fabs(a0) > it->friction) {
            mode = 2;
            if (res.outcome < SP_SLID) res.outcome = SP_SLID;
          }
        } else if (a0 < -tip) {
          mode = 1; /* the floor lurches back: the item tips forwards */
          th = 1e-9;
          om = 0;
        } else if (a0 > tip && !it->backed) {
          mode = 1;
          th = -1e-9;
          om = 0;
        }
      }
      if (mode == 2) {
        /* Coulomb friction: the floor drags the item until their speeds match again. */
        const double dir = uv > 0 ? 1 : uv < 0 ? -1 : (a0 > 0 ? -1 : 1);
        const double acc = -(am + it->friction * dir) * SP_G;
        const double nv = uv + h * acc;
        if ((uv > 0 && nv <= 0) || (uv < 0 && nv >= 0)) {
          uv = 0;
          if (sp_fabs(a1) <= it->friction) mode = 0;
        } else {
          uv = nv;
        }
        u += h * uv;
        if (sp_fabs(u) > res.slide) res.slide = sp_fabs(u);
      } else if (mode == 1 || mode == 3) {
        /* Classic fourth-order Runge–Kutta on (theta, omega). */
        const double k1t = om, k1o = rock_acc(&s, th, a0);
        const double k2t = om + 0.5 * h * k1o, k2o = rock_acc(&s, th + 0.5 * h * k1t, am);
        const double k3t = om + 0.5 * h * k2o, k3o = rock_acc(&s, th + 0.5 * h * k2t, am);
        const double k4t = om + h * k3o, k4o = rock_acc(&s, th + h * k3t, a1);
        const double nth = th + h / 6 * (k1t + 2 * k2t + 2 * k3t + k4t);
        const double nom = om + h / 6 * (k1o + 2 * k2o + 2 * k3o + k4o);
        if (mode == 1 && ((th > 0 && nth <= 0) || (th < 0 && nth >= 0))) {
          /* It lands back on its base: an impact, then it rocks on the other edge. */
          th = 0;
          om = s.restore * nom;
          if (it->backed && om < 0) om = -s.restore * om; /* the wall behind turns it back again */
          if (sp_fabs(om) < 1e-4) {
            om = 0;
            mode = 0;
          } else {
            th = om > 0 ? 1e-9 : -1e-9;
          }
        } else {
          th = nth;
          om = nom;
          if (res.outcome < SP_ROCKED) res.outcome = SP_ROCKED;
          const double frac = sp_fabs(th) / s.alpha;
          if (frac > res.peak) res.peak = frac;
          if (mode == 1 && frac >= 1.0) {
            /* Past the tipping point the centre of mass is beyond the edge: it falls. */
            res.outcome = SP_TOPPLED;
            res.forwards = th > 0;
            res.when = i * SP_DT;
            if (!trace) return res;
            mode = 3;
          }
          if (mode == 3 && sp_fabs(th) >= PI / 2) {
            th = th > 0 ? PI / 2 : -PI / 2;
            om = 0;
            mode = 4;
          }
        }
      }
    }
    prev = next;
    if (trace && every > 0 && i % every == 0) {
      trace[(size_t)2 * (size_t)written] = (float)th;
      trace[(size_t)2 * (size_t)written + 1] = (float)u;
      written++;
    }
  }
  if (ntrace) *ntrace = written;
  if (res.peak > 1) res.peak = 1;
  return res;
}
