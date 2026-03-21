import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://idypfzpfrgvtkypasqhl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SNwAYSpiLmXrZYdK-0P7uA_mrDiF8wb';

const BADGE_STYLES = {
  TELL_ME_ITS_GOOD: { background: '#ECFDF5', color: '#3A9E6F' },
  CLEAN_PICK:       { background: '#ECFDF5', color: '#0F6E56' },
  ETHICAL_PICK:     { background: '#EEF2FF', color: '#4338CA' },
  QUALITY_PICK:     { background: '#EBF1FD', color: '#2F6FED' },
  NOT_LISTED:       { background: '#FEF2F2', color: '#D94F4F' },
};

function badgeLabel(badge) {
  return (badge || '').replace(/_/g, ' ');
}

function genericCard() {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '1200px',
        height: '630px',
        background: '#FAF8F5',
        fontFamily: 'Georgia, serif',
        padding: '60px',
        justifyContent: 'space-between',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              color: '#A09891',
              fontSize: '18px',
              letterSpacing: '0.12em',
              fontFamily: 'sans-serif',
              textTransform: 'uppercase',
            },
            children: 'TELLMEITSGOOD.COM',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '16px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '52px',
                    color: '#1C1917',
                    fontFamily: 'Georgia, serif',
                    lineHeight: 1.15,
                    maxWidth: '900px',
                  },
                  children: 'AI-researched product verdicts',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '22px',
                    color: '#A09891',
                    fontFamily: 'sans-serif',
                  },
                  children: 'Quality · Safety · Ethics',
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              background: '#1C1917',
              color: '#FFFFFF',
              fontSize: '18px',
              fontFamily: 'sans-serif',
              padding: '20px 40px',
              borderRadius: '0px',
              marginLeft: '-60px',
              marginRight: '-60px',
              marginBottom: '-60px',
              paddingLeft: '60px',
              paddingRight: '60px',
              alignItems: 'center',
            },
            children: 'AI-researched · Quality · Safety · Ethics · tellmeitsgood.com',
          },
        },
      ],
    },
  };
}

function productCard(product) {
  const { product_name, badge, overall_score } = product;
  const badgeStyle = BADGE_STYLES[badge] || { background: '#F3F4F6', color: '#6B7280' };
  const scoreDisplay = overall_score != null ? String(Number(overall_score).toFixed(1)) : '—';

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '1200px',
        height: '630px',
        background: '#FAF8F5',
        fontFamily: 'Georgia, serif',
        padding: '60px',
        justifyContent: 'space-between',
      },
      children: [
        // Top: logo
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              color: '#A09891',
              fontSize: '18px',
              letterSpacing: '0.12em',
              fontFamily: 'sans-serif',
              textTransform: 'uppercase',
            },
            children: 'TELLMEITSGOOD.COM',
          },
        },

        // Middle: name + badge on left, score on right
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              flex: 1,
              paddingTop: '40px',
              paddingBottom: '32px',
            },
            children: [
              // Left: name + badge
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px',
                    maxWidth: '820px',
                    justifyContent: 'flex-end',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '52px',
                          color: '#1C1917',
                          fontFamily: 'Georgia, serif',
                          lineHeight: 1.2,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        },
                        children: product_name || 'Product',
                      },
                    },
                    badge
                      ? {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              background: badgeStyle.background,
                              color: badgeStyle.color,
                              fontSize: '20px',
                              fontFamily: 'sans-serif',
                              fontWeight: '600',
                              padding: '10px 22px',
                              borderRadius: '999px',
                              alignSelf: 'flex-start',
                              letterSpacing: '0.04em',
                            },
                            children: badgeLabel(badge),
                          },
                        }
                      : null,
                  ].filter(Boolean),
                },
              },

              // Right: score
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    minWidth: '160px',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '96px',
                          color: '#1C1917',
                          fontFamily: 'Georgia, serif',
                          lineHeight: 1,
                          fontWeight: '700',
                        },
                        children: scoreDisplay,
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '24px',
                          color: '#A09891',
                          fontFamily: 'sans-serif',
                          marginTop: '4px',
                        },
                        children: '/ 10',
                      },
                    },
                  ],
                },
              },
            ],
          },
        },

        // Bottom strip
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              background: '#1C1917',
              color: '#FFFFFF',
              fontSize: '18px',
              fontFamily: 'sans-serif',
              padding: '20px 60px',
              marginLeft: '-60px',
              marginRight: '-60px',
              marginBottom: '-60px',
              alignItems: 'center',
            },
            children: 'AI-researched · Quality · Safety · Ethics · tellmeitsgood.com',
          },
        },
      ],
    },
  };
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get('slug');

    if (!slug) {
      return new ImageResponse(genericCard(), {
        width: 1200,
        height: 630,
        headers: {
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
      });
    }

    const apiUrl =
      `${SUPABASE_URL}/rest/v1/products` +
      `?slug=eq.${encodeURIComponent(slug)}` +
      `&is_public=eq.true` +
      `&select=product_name,badge,overall_score,category`;

    const res = await fetch(apiUrl, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const data = await res.json();
    const product = Array.isArray(data) && data.length > 0 ? data[0] : null;

    const tree = product ? productCard(product) : genericCard();

    return new ImageResponse(tree, {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (err) {
    return new ImageResponse(genericCard(), {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  }
}
