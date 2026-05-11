from flask import Blueprint, jsonify
from controllers.billingController import get_all_invoices, get_invoices_by_order

billing_bp = Blueprint('billing', __name__)

@billing_bp.route('/')
def index():
    return jsonify({'service': 'Billing Service', 'status': 'running', 'message': 'API is up and running'})

@billing_bp.route('/api/invoices')
def get_invoices():
    return jsonify(get_all_invoices())

@billing_bp.route('/api/invoices/order/<order_id>')
def get_invoices_order(order_id):
    return jsonify(get_invoices_by_order(order_id))
