
const http = require('http');
// We'll try to require it. It will fail if not exported.
const medusaServer = require('./medusa-server');

jest.mock('http');

describe('Issue #5 Reproduction: Bridge signs A2A requests', () => {
  it('should have callA2A exported', () => {
    expect(medusaServer.callA2A).toBeDefined();
  });

  it('should include HMAC signing headers in A2A requests', async () => {
    const mockReq = {
      on: jest.fn((event, cb) => {
        if (event === 'error') return;
        return mockReq;
      }),
      write: jest.fn(),
      end: jest.fn(() => {
        // Trigger the 'end' event on the response
        if (mockResCb) {
          const mockRes = {
            statusCode: 200,
            on: jest.fn((event, cb) => {
              if (event === 'data') cb('{"success":true}');
              if (event === 'end') cb();
            })
          };
          mockResCb(mockRes);
        }
      })
    };

    let mockResCb;
    http.request.mockImplementation((url, options, cb) => {
      mockResCb = cb;
      return mockReq;
    });

    await medusaServer.callA2A('POST', '/a2a/messages/send', { test: 'data' });

    const options = http.request.mock.calls[0][1];
    expect(options.headers).toHaveProperty('X-Medusa-Timestamp');
    expect(options.headers).toHaveProperty('X-Medusa-Signature');
  });
});
