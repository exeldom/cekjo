"""Retire legacy offline sync without serving private data to old clients."""
def register_offline(app, db):
    @app.get('/api/offline-manifest')
    @app.get('/api/offline-table/<tid>')
    @app.get('/api/offline-snapshot')
    def offline_retired(tid=None):
        return {'upgrade_required': True}, 410, {'Cache-Control': 'no-store'}
