from flask import Blueprint, jsonify, request
from controllers.notificationController import all_notifications
from sockets.sseHandler import sse_response

notif_bp = Blueprint('notifications', __name__)

@notif_bp.route('/')
def index():
    return jsonify({'service': 'Notification Service', 'status': 'running', 'message': 'API is up and running'})

@notif_bp.route('/api/notifications')
def get_all():
    order_id = request.args.get('order_id')
    return jsonify(all_notifications(order_id))

@notif_bp.route('/api/notifications/stream')
def sse_stream():
    """Server-Sent Events: /api/notifications/stream?order_id=XYZ (or global)"""
    order_id = request.args.get('order_id', 'global')
    return sse_response(order_id)
