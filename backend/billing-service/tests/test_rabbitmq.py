import json
import pytest
from unittest.mock import patch, MagicMock

from sockets.rabbitmqConsumer import process_message

def test_process_message_entregado(mocker):
    # Mockear save_invoice
    mock_save = mocker.patch('sockets.rabbitmqConsumer.save_invoice', return_value=123)
    
    body = json.dumps({
        'orderId': 'O-100',
        'status': 'entregado',
        'customerName': 'Juan Perez',
        'address': 'Calle 123'
    }).encode('utf-8')
    
    process_message(body, retries=0)
    
    mock_save.assert_called_once_with('O-100', 'entregado', 'Juan Perez', 'Calle 123', 15.99, 0)

def test_process_message_recogiendo(mocker):
    mock_save = mocker.patch('sockets.rabbitmqConsumer.save_invoice', return_value=124)
    
    body = json.dumps({
        'orderId': 'O-101',
        'status': 'recogiendo'
    }).encode('utf-8')
    
    process_message(body, retries=0)
    
    # Monto debe ser 0.0 para recogiendo
    mock_save.assert_called_once_with('O-101', 'recogiendo', 'Cliente', 'N/A', 0.0, 0)
