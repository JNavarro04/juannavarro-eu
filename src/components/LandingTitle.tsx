import { SITE } from '../config/site'
import '../styles/landingTitle.css'

/**
 * The wordmark over the sphere.
 *
 * Opacity is driven by `--choreo-text-opacity`, which ScrollChoreography
 * publishes on <html> every frame — so the title dissolves as the camera zooms
 * in without React re-rendering, and comes back on the way out.
 *
 * It is positioned by the same geometry the sphere uses: the globe spans
 * VIEWPORT_FRACTION (0.68) of the smaller viewport axis, so its top edge sits
 * 0.34 of that axis above centre. Translating up by that much plus a gap puts
 * the wordmark just clear of the photographs at every aspect ratio, instead of
 * landing on top of them.
 */
export default function LandingTitle() {
  return (
    <div className="landing-title" aria-hidden="false">
      <div className="landing-title__inner">
        {/* Logo slot — drop an <img>/<svg> here when the mark is ready.
            Sized by --landing-logo-size so it aligns with the name. */}
        <h1 className="landing-title__name">{SITE.name}</h1>
      </div>
    </div>
  )
}
