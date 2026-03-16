const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Fix 1: The .map() needs to close with })} not ))}
// The return statement for regular buttons doesn't have the closing }
app = app.replace(
  `            </button>
          ))}
        </nav>

        
          </div>
        )}

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #102f54', background: '#143d6b' }}>`,
  `            </button>
            );
          })}
        </nav>

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #102f54', background: '#143d6b' }}>`
);

// Fix 2: The Google apps links should use same active color as CareCoord items
// Change from #a8c8e8 to #143d6b to match
app = app.replace(
  `color: '#a8c8e8',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',`,
  `color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ App.jsx — syntax fixed, Google apps same color as nav items');
console.log('Refresh browser.');
