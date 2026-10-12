/** Who is calling and in which workspace they act. Set by authentication on every request. */
export interface AuthContext {
  readonly userId: string;
  readonly workspaceId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}
